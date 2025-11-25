// ==========================================
// CONFIGURATION
// ==========================================
const REPO_BASE = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + "/";
// Board Dimensions (Holes) - FIXED
const BOARD_W_HOLES = 46; 
const BOARD_H_HOLES = 64;

// STATE
let fileIndex = [];
let pogData = [];
let storeMap = [];
let currentStore = null;
let currentPOG = null;
let currentBay = 1;
let allBays = [];
let html5QrCode = null;
let PPI = 10; // Will be calculated
let completedItems = new Set(JSON.parse(localStorage.getItem('harpa_complete') || "[]"));

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    init();
    setupSwipe();
});

async function init() {
    try {
        await loadCSVData();
        document.getElementById('loading-overlay').classList.add('hidden');
        const savedStore = localStorage.getItem('harpa_store');
        if (savedStore) loadStoreLogic(savedStore);
        else document.getElementById('store-modal').classList.remove('hidden');
    } catch (error) {
        alert("Data Error: " + error.message);
    }

    document.getElementById('btn-load-store').onclick = () => loadStoreLogic(document.getElementById('store-input').value.trim());
    document.getElementById('btn-scan-toggle').onclick = startScanner;
    document.getElementById('btn-manual-search').onclick = () => handleSearchOrScan(document.getElementById('search-input').value.trim());
    document.getElementById('prev-bay').onclick = () => changeBay(-1);
    document.getElementById('next-bay').onclick = () => changeBay(1);
}

// ==========================================
// DATA LOADING
// ==========================================
async function loadCSVData() {
    const ts = new Date().getTime();
    const [filesReq, pogReq, mapReq] = await Promise.all([
        fetch(`githubfiles.csv?t=${ts}`),
        fetch(`allplanogramdata.csv?t=${ts}`),
        fetch(`Store_POG_Mapping.csv?t=${ts}`)
    ]);

    if (!filesReq.ok || !pogReq.ok || !mapReq.ok) throw new Error("Failed to fetch CSVs");

    const filesText = await filesReq.text();
    const pogText = await pogReq.text();
    const mapText = await mapReq.text();

    fileIndex = filesText.split('\n').map(l => l.trim());
    storeMap = parseCSV(mapText);
    
    // Parse and Clean Data
    const rawPOG = parseCSV(pogText);
    pogData = rawPOG.map(item => {
        item.CleanUPC = normalizeUPC(item.UPC);
        return item;
    });
}

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const headers = lines[0].split(',').map(h => h.trim());
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',');
        if (row.length < headers.length) continue;
        let obj = {};
        headers.forEach((h, idx) => {
            obj[h] = row[idx] ? row[idx].trim() : "";
        });
        result.push(obj);
    }
    return result;
}

function normalizeUPC(upc) {
    if (!upc) return "";
    // 1. Remove whitespace
    // 2. Remove all leading zeros
    return upc.toString().trim().replace(/^0+/, '');
}

// ==========================================
// STORE & BAY LOGIC
// ==========================================
function loadStoreLogic(storeNum) {
    const mapping = storeMap.find(s => s.Store === storeNum);
    if (!mapping) {
        document.getElementById('error-msg').classList.remove('hidden');
        return;
    }
    currentStore = storeNum;
    currentPOG = mapping.POG;
    localStorage.setItem('harpa_store', storeNum);

    const items = pogData.filter(i => i.POG === currentPOG);
    allBays = [...new Set(items.map(i => parseInt(i.Bay)))].sort((a,b) => a-b);

    if (allBays.length === 0) return alert("POG " + currentPOG + " has no items.");

    document.getElementById('store-modal').classList.add('hidden');
    document.getElementById('store-display').innerText = `Store #${storeNum}`;
    document.getElementById('pog-display').innerText = currentPOG;
    document.getElementById('error-msg').classList.add('hidden');

    loadBay(allBays[0]);
}

function resetStore() {
    localStorage.removeItem('harpa_store');
    location.reload();
}

function changeBay(dir) {
    const idx = allBays.indexOf(currentBay);
    if(idx === -1) return;
    let newIdx = idx + dir;
    if(newIdx < 0) newIdx = 0;
    if(newIdx >= allBays.length) newIdx = allBays.length - 1;
    if(allBays[newIdx] !== currentBay) loadBay(allBays[newIdx]);
}

function loadBay(bayNum) {
    currentBay = bayNum;
    document.getElementById('bay-indicator').innerText = `Bay ${bayNum} of ${allBays.length}`;
    document.getElementById('prev-bay').style.opacity = (bayNum === allBays[0]) ? "0.3" : "1";
    document.getElementById('next-bay').style.opacity = (bayNum === allBays[allBays.length - 1]) ? "0.3" : "1";
    renderBoard(bayNum);
}

// ==========================================
// BOARD RENDERING (The Frog)
// ==========================================
function renderBoard(bayNum) {
    const container = document.getElementById('pegboard-container');
    container.innerHTML = '';

    // 1. Calculate PPI to fit screen Width
    // Get container width available
    const screenWidth = document.getElementById('main-scroll-area').clientWidth;
    // We need 46 holes to fit in this width.
    // Add a small margin buffer (e.g. 20px)
    PPI = (screenWidth - 20) / BOARD_W_HOLES;
    
    const wPx = BOARD_W_HOLES * PPI;
    const hPx = BOARD_HEIGHT_HOLES * PPI;

    container.style.width = `${wPx}px`;
    container.style.height = `${hPx}px`;

    // 2. Draw Peg Holes (High Contrast CSS)
    // Using 20% dark gray dot
    container.style.backgroundSize = `${PPI}px ${PPI}px`;
    container.style.backgroundImage = `radial-gradient(circle, #111 20%, transparent 21%)`;

    // 3. Place Items
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
    let complete = 0;

    items.forEach(item => {
        // Format: R02 C03
        const { r, c } = getCoords(item.Peg);
        
        // Dimensions: remove " in" and convert to pixels
        const hVal = parseFloat(item.Height.replace(' in', '')) || 6;
        const wVal = parseFloat(item.Width.replace(' in', '')) || 3;
        const hPxItem = hVal * PPI;
        const wPxItem = wVal * PPI;

        // --- POSITIONING (Frog Logic) ---
        // Grid (1,1) is top-left.
        // Hole (C, R) is the LEFT leg.
        // X of Left Leg Hole Center = (C - 0.5) * PPI
        // Y of Row Center = (R - 0.5) * PPI
        
        // NOTE: standard grid 0-based for math:
        // Hole 1 is at 0*PPI to 1*PPI. Center is 0.5*PPI.
        
        const holeCenterX = (c - 0.5) * PPI;
        const holeCenterY = (r - 0.5) * PPI;

        // Draw Red Dot (Left Leg)
        const dot = document.createElement('div');
        dot.className = 'frog-dot';
        dot.style.left = `${holeCenterX}px`;
        dot.style.top = `${holeCenterY}px`;
        container.appendChild(dot);

        // Draw Product
        // Frog Spans 2 holes (C and C+1).
        // Center of product is exactly between Hole C and Hole C+1.
        // Center X = holeCenterX + (0.5 inches * PPI)
        const productCenterX = holeCenterX + (0.5 * PPI);
        
        // Product Top = holeCenterY (Hanging from that row)
        // Product Left = productCenterX - (Width / 2)
        const boxLeft = productCenterX - (wPxItem / 2);
        const boxTop = holeCenterY + (0.5 * PPI); // Hang slightly below hole center

        const box = document.createElement('div');
        box.className = 'product-box';
        box.style.width = `${wPxItem}px`;
        box.style.height = `${hPxItem}px`;
        box.style.left = `${boxLeft}px`;
        box.style.top = `${boxTop}px`;
        box.dataset.upc = item.CleanUPC;

        if (completedItems.has(item.CleanUPC)) {
            box.classList.add('completed');
            complete++;
        }

        // Image (Raw UPC match)
        const imgName = fileIndex.find(f => f.startsWith(item.UPC));
        if (imgName) {
            const img = document.createElement('img');
            img.src = imgName;
            img.loading = "lazy";
            box.appendChild(img);
        } else {
            box.innerHTML = `<div style="font-size:${PPI*0.4}px; text-align:center; overflow:hidden; padding:1px;">${item.UPC}</div>`;
        }

        box.onclick = () => toggleComplete(item.CleanUPC, box);
        container.appendChild(box);
    });

    const pct = items.length ? Math.round((complete/items.length)*100) : 0;
    document.getElementById('progress-fill').style.width = `${pct}%`;
}

function getCoords(str) {
    if(!str) return {r:1, c:1};
    const m = str.match(/R(\d+)\s*C(\d+)/);
    if(m) return { r: parseInt(m[1]), c: parseInt(m[2]) };
    return { r: 1, c: 1 };
}

// ==========================================
// UTILS
// ==========================================
function toggleComplete(upc, el) {
    if (completedItems.has(upc)) {
        completedItems.delete(upc);
        el.classList.remove('completed');
    } else {
        completedItems.add(upc);
        el.classList.add('completed');
    }
    localStorage.setItem('harpa_complete', JSON.stringify([...completedItems]));
}

function loadProgress() {
    const s = localStorage.getItem('harpa_complete');
    if(s) completedItems = new Set(JSON.parse(s));
}

// ==========================================
// SCANNER
// ==========================================
function startScanner() {
    document.getElementById('scanner-modal').classList.remove('hidden');
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" }, 
        { fps: 10, qrbox: 250 },
        (decodedText) => handleSearchOrScan(decodedText),
        () => {}
    ).catch(err => {
        alert("Camera Error: " + err);
        stopScanner();
    });
}

function stopScanner() {
    if(html5QrCode) {
        html5QrCode.stop().then(() => {
            document.getElementById('scanner-modal').classList.add('hidden');
            html5QrCode.clear();
        }).catch(() => document.getElementById('scanner-modal').classList.add('hidden'));
    } else {
        document.getElementById('scanner-modal').classList.add('hidden');
    }
}

function handleSearchOrScan(input) {
    if(!input) return;
    const clean = normalizeUPC(input);
    document.getElementById('scan-debug').innerHTML = `Scanned: <b>${input}</b> | ID: <b>${clean}</b>`;

    // 1. Search GLOBAL POG
    // Check exact match OR match with leading zeros stripped from input
    const match = pogData.find(i => i.POG === currentPOG && i.CleanUPC === clean);

    if (!match) {
        document.getElementById('scan-debug').style.color = "red";
        document.getElementById('scan-debug').innerHTML += " - NOT FOUND";
        return;
    }

    document.getElementById('scan-debug').style.color = "green";
    
    // 2. Check Bay
    const bay = parseInt(match.Bay);
    if (bay !== currentBay) {
        loadBay(bay);
        setTimeout(() => highlightItem(clean), 500); // wait for render
    } else {
        highlightItem(clean);
    }
}

function highlightItem(upc) {
    const box = document.querySelector(`.product-box[data-upc="${upc}"]`);
    if(box) {
        box.scrollIntoView({behavior:"smooth", block:"center"});
        box.classList.add('highlight');
        if(!box.classList.contains('completed')) toggleComplete(upc, box);
        setTimeout(() => box.classList.remove('highlight'), 2000);
    }
}

// ==========================================
// SWIPE & PDF
// ==========================================
function setupSwipe() {
    let xDown = null;
    const el = document.getElementById('main-scroll-area');
    el.addEventListener('touchstart', evt => xDown = evt.touches[0].clientX, {passive: true});
    el.addEventListener('touchmove', evt => {
        if (!xDown) return;
        let xUp = evt.touches[0].clientX;
        let xDiff = xDown - xUp;
        if (Math.abs(xDiff) > 100) {
            if (xDiff > 0) changeBay(1); // Left Swipe -> Next
            else changeBay(-1);
            xDown = null;
        }
    }, {passive: true});
}

function openPDF() {
    if(!currentPOG) return alert("Select store first");
    const pdf = fileIndex.find(f => f.includes(currentPOG) && f.endsWith('.pdf'));
    if(pdf) {
        document.getElementById('pdf-frame').src = pdf;
        document.getElementById('pdf-modal').classList.remove('hidden');
    } else {
        alert("PDF not found.");
    }
}
function closePDF() {
    document.getElementById('pdf-modal').classList.add('hidden');
    document.getElementById('pdf-frame').src = "";
}
