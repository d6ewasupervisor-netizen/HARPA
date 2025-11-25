// ==========================================
// CONFIGURATION
// ==========================================
const REPO_BASE = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + "/";

// DISPLAY SCALING
// 16px = 1 inch (1 hole distance). 
// Board Width = 46 holes * 16px = 736px.
// This fits well on landscape phones or allows slight scrolling on portrait.
const PPI = 16; 
const BOARD_W_HOLES = 46;
const BOARD_H_HOLES = 64;

// ==========================================
// GLOBAL STATE
// ==========================================
let fileIndex = [];
let pogData = [];
let storeMap = [];
let currentStore = null;
let currentPOG = null;
let currentBay = 1;
let allBays = [];
let html5QrCode = null;
let completedItems = new Set(JSON.parse(localStorage.getItem('harpa_complete') || "[]"));

// ==========================================
// INITIALIZATION
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
        if (savedStore) {
            loadStoreLogic(savedStore);
        } else {
            document.getElementById('store-modal').classList.remove('hidden');
        }
    } catch (error) {
        document.getElementById('loading-title').textContent = "Error";
        document.getElementById('loading-text').textContent = error.message;
    }

    // Bind Inputs
    document.getElementById('btn-load-store').onclick = () => {
        loadStoreLogic(document.getElementById('store-input').value.trim());
    };
    document.getElementById('btn-scan-toggle').onclick = startScanner;
    document.getElementById('btn-manual-search').onclick = () => {
        handleSearchOrScan(document.getElementById('search-input').value.trim());
    };
    document.getElementById('prev-bay').onclick = () => changeBay(-1);
    document.getElementById('next-bay').onclick = () => changeBay(1);
}

// ==========================================
// DATA FETCHING & NORMALIZATION
// ==========================================
function normalizeUPC(upc) {
    if (!upc) return "";
    // Remove ALL leading zeros to match Excel integer exports
    return upc.toString().trim().replace(/^0+/, '');
}

async function loadCSVData() {
    const ts = new Date().getTime();
    const [filesReq, pogReq, mapReq] = await Promise.all([
        fetch(`githubfiles.csv?t=${ts}`),
        fetch(`allplanogramdata.csv?t=${ts}`),
        fetch(`Store_POG_Mapping.csv?t=${ts}`)
    ]);

    if (!filesReq.ok || !pogReq.ok || !mapReq.ok) throw new Error("Failed to fetch data files.");

    const filesText = await filesReq.text();
    const pogText = await pogReq.text();
    const mapText = await mapReq.text();

    fileIndex = filesText.split('\n').map(l => l.trim());
    storeMap = parseCSV(mapText);
    
    // Parse POG Data and add 'CleanUPC' property
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

// ==========================================
// STORE LOGIC
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

    // Find all bays associated with this POG
    const items = pogData.filter(i => i.POG === currentPOG);
    allBays = [...new Set(items.map(i => parseInt(i.Bay)))].sort((a,b) => a-b);
    
    if (allBays.length === 0) return alert("No items found for POG " + currentPOG);

    document.getElementById('store-modal').classList.add('hidden');
    document.getElementById('store-display').innerText = `Store #${storeNum}`;
    document.getElementById('pog-display').innerText = `POG: ${currentPOG}`;
    document.getElementById('error-msg').classList.add('hidden');

    loadBay(allBays[0]);
}

function resetStore() {
    localStorage.removeItem('harpa_store');
    location.reload();
}

// ==========================================
// BAY NAVIGATION
// ==========================================
function changeBay(dir) {
    const idx = allBays.indexOf(currentBay);
    if(idx === -1) return;
    let newIdx = idx + dir;
    // Cycle vs Stop at edges? User asked for swipe, usually stops at edge.
    if(newIdx < 0) newIdx = 0;
    if(newIdx >= allBays.length) newIdx = allBays.length - 1;
    
    if(allBays[newIdx] !== currentBay) loadBay(allBays[newIdx]);
}

function loadBay(bayNum) {
    currentBay = bayNum;
    document.getElementById('bay-indicator').innerText = `Bay ${bayNum} of ${allBays.length}`;
    
    document.getElementById('prev-bay').style.opacity = (bayNum === allBays[0]) ? "0.3" : "1";
    document.getElementById('next-bay').style.opacity = (bayNum === allBays[allBays.length - 1]) ? "0.3" : "1";

    renderPegboard(bayNum);
}

// ==========================================
// RENDERER: THE FROG BOARD
// ==========================================
function renderPegboard(bayNum) {
    const container = document.getElementById('pegboard-container');
    container.innerHTML = '';

    // 1. Force Dimensions
    const wPx = BOARD_WIDTH_HOLES * PPI;
    const hPx = BOARD_HEIGHT_HOLES * PPI;
    
    container.style.width = `${wPx}px`;
    container.style.height = `${hPx}px`;

    // 2. Draw Visual Grid (Dots)
    // We create a background div to ensure dots render even if data is empty
    const bg = document.createElement('div');
    bg.className = 'peg-hole-pattern';
    bg.style.backgroundSize = `${PPI}px ${PPI}px`;
    bg.style.backgroundImage = `radial-gradient(circle, #000 1.5px, transparent 2px)`;
    container.appendChild(bg);

    // 3. Filter Items
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
    let complete = 0;

    items.forEach(item => {
        const cleanUPC = item.CleanUPC;
        const { r, c } = getPegCoords(item.Peg);
        
        // Size
        const h = parseFloat(item.Height.replace(' in','')) || 6;
        const w = parseFloat(item.Width.replace(' in','')) || 3;
        const hPxItem = h * PPI;
        const wPxItem = w * PPI;

        // --- FROG MATH ---
        // C = Left Leg Hole. (1-based index)
        // Hole position = (C-1)*PPI + HalfPPI (to center in the 1-inch square)
        const frogX = (c - 1) * PPI;
        const frogY = (r - 1) * PPI;

        // 1. Red Dot (The Left Leg)
        const dot = document.createElement('div');
        dot.className = 'frog-dot';
        dot.style.left = `${frogX + (PPI/2)}px`;
        dot.style.top = `${frogY + (PPI/2)}px`;
        container.appendChild(dot);

        // 2. Product Box
        // Spans Frog Leg (Hole C) and Right Leg (Hole C+1)
        // Midpoint = frogX + PPI/2 (Center of Left Hole) + PPI/2 (Half inch move right)
        const centerX = frogX + (PPI/2) + (PPI/2); 
        
        const boxLeft = centerX - (wPxItem / 2);
        const boxTop = frogY + (PPI/2); // Hangs from the peg row

        const box = document.createElement('div');
        box.className = 'product-box';
        box.style.width = `${wPxItem}px`;
        box.style.height = `${hPxItem}px`;
        box.style.left = `${boxLeft}px`;
        box.style.top = `${boxTop}px`;
        
        box.dataset.upc = cleanUPC;

        if (completedItems.has(cleanUPC)) {
            box.classList.add('completed');
            complete++;
        }

        // Image Matching
        const imgFile = fileIndex.find(f => f.startsWith(item.UPC));
        if (imgFile) {
            const img = document.createElement('img');
            img.src = imgFile;
            img.loading = "lazy";
            box.appendChild(img);
        } else {
            box.innerHTML = `<span style="font-size:9px; text-align:center; padding:1px; word-break:break-all;">${item.UPC}</span>`;
        }

        box.onclick = () => toggleComplete(cleanUPC, box);
        container.appendChild(box);
    });

    updateProgress(complete, items.length);
}

function getPegCoords(str) {
    // "R02 C03"
    if(!str) return {r:1, c:1};
    const m = str.match(/R(\d+)\s*C(\d+)/);
    if(m) return { r: parseInt(m[1]), c: parseInt(m[2]) };
    return {r:1, c:1};
}

// ==========================================
// UTILITIES
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
    
    // Update Bar
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
    const done = items.filter(i => completedItems.has(i.CleanUPC)).length;
    updateProgress(done, items.length);
}

function updateProgress(done, total) {
    const pct = total > 0 ? Math.round((done/total)*100) : 0;
    document.getElementById('progress-fill').style.width = `${pct}%`;
    document.getElementById('progress-count').innerText = `${done} / ${total} (${pct}%)`;
}

function loadProgress() {
    const s = localStorage.getItem('harpa_complete');
    if(s) completedItems = new Set(JSON.parse(s));
}

// ==========================================
// SCANNER & SEARCH
// ==========================================
function startScanner() {
    const modal = document.getElementById('scanner-modal');
    modal.classList.remove('hidden');
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" }, 
        { fps: 10, qrbox: 250 },
        (decodedText) => {
            // Keep camera open, just act on data
            handleSearchOrScan(decodedText);
        },
        () => {}
    ).catch(err => {
        alert("Camera Error: " + err);
        stopScanner();
    });
}

function stopScanner() {
    if(html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            document.getElementById('scanner-modal').classList.add('hidden');
        });
    } else {
        document.getElementById('scanner-modal').classList.add('hidden');
    }
}

function handleSearchOrScan(inputVal) {
    if(!inputVal) return;
    
    const clean = normalizeUPC(inputVal);
    document.getElementById('scan-debug').innerText = `Scanned: ${inputVal} -> ID: ${clean}`;

    // 1. Search Whole POG
    const match = pogData.find(i => i.POG === currentPOG && i.CleanUPC === clean);

    if(!match) {
        document.getElementById('scan-debug').innerText += " (Not Found)";
        document.getElementById('scan-debug').style.color = "red";
        return;
    }
    
    document.getElementById('scan-debug').style.color = "green";

    // 2. Check Bay
    const bay = parseInt(match.Bay);
    if(bay !== currentBay) {
        loadBay(bay);
        setTimeout(() => highlightItem(clean), 300);
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
// PDF & SWIPE
// ==========================================
function openPDF() {
    if(!currentPOG) return alert("Select store first");
    const pdf = fileIndex.find(f => f.includes(currentPOG) && f.endsWith('.pdf'));
    if(pdf) {
        document.getElementById('pdf-frame').src = pdf;
        document.getElementById('pdf-modal').classList.remove('hidden');
    } else {
        alert("PDF not found for POG " + currentPOG);
    }
}
function closePDF() {
    document.getElementById('pdf-modal').classList.add('hidden');
    document.getElementById('pdf-frame').src = "";
}

function setupSwipe() {
    let startX = 0;
    const el = document.getElementById('main-scroll-area');
    el.addEventListener('touchstart', e => startX = e.changedTouches[0].screenX, {passive:true});
    el.addEventListener('touchend', e => {
        const diff = e.changedTouches[0].screenX - startX;
        if(Math.abs(diff) > 75) { // Threshold
            if(diff > 0) changeBay(-1);
            else changeBay(1);
        }
    }, {passive:true});
}
