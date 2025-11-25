// ==========================================
// CONFIGURATION
// ==========================================
const REPO_BASE = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + "/";
const IMG_PATH = ""; // Root folder based on your file list

// PHYSICAL DIMENSIONS (HOLES)
// The board is exactly this grid size
const BOARD_W_HOLES = 46; 
const BOARD_H_HOLES = 64;

// VISUAL SCALE
// 1 Hole (1 inch) = 16 Pixels on screen. 
// This makes the full board 736px wide. On mobile this will fit or slightly scroll.
const PPI = 16; 

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
// DATA FETCHING
// ==========================================
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
    pogData = parseCSV(pogText);
    storeMap = parseCSV(mapText);
    
    // Pre-normalize UPCs in memory for fast searching
    pogData.forEach(item => {
        item.CleanUPC = normalizeUPC(item.UPC);
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
    // Strip all leading zeros
    return upc.toString().trim().replace(/^0+/, '');
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

    const items = pogData.filter(i => i.POG === currentPOG);
    allBays = [...new Set(items.map(i => parseInt(i.Bay)))].sort((a,b) => a-b);
    
    if (allBays.length === 0) return alert("No data for POG " + currentPOG);

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
    
    // Opacity for nav buttons
    document.getElementById('prev-bay').style.opacity = (bayNum === allBays[0]) ? 0.3 : 1;
    document.getElementById('next-bay').style.opacity = (bayNum === allBays[allBays.length - 1]) ? 0.3 : 1;

    renderPegboard(bayNum);
}

// ==========================================
// RENDERER
// ==========================================
function renderPegboard(bayNum) {
    const container = document.getElementById('pegboard-container');
    container.innerHTML = '';

    // 1. Set Board Dimensions (Pixels)
    const wPx = BOARD_WIDTH_HOLES * PPI;
    const hPx = BOARD_HEIGHT_HOLES * PPI;
    
    container.style.width = `${wPx}px`;
    container.style.height = `${hPx}px`;

    // 2. Generate Grid Pattern (CSS)
    // Radial gradient creates 2px dots spaced PPI apart
    container.style.backgroundSize = `${PPI}px ${PPI}px`;
    container.style.backgroundImage = `radial-gradient(circle, #222 1.5px, transparent 2px)`;

    // 3. Place Items
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
    let complete = 0;

    items.forEach(item => {
        // Coords: 1-based index. (1,1) is top left.
        const { r, c } = getPegCoords(item.Peg);
        
        // Size (Inches to Pixels)
        const h = parseFloat(item.Height.replace(' in','')) || 6;
        const w = parseFloat(item.Width.replace(' in','')) || 3;
        const hPxItem = h * PPI;
        const wPxItem = w * PPI;

        // --- FROG POSITIONING ---
        // The data (e.g., R02 C03) specifies the LEFT LEG hole.
        // Hole C is at X = (C-1)*PPI.
        // Hole R is at Y = (R-1)*PPI.
        const frogX = (c - 1) * PPI;
        const frogY = (r - 1) * PPI;

        // 1. Draw RED DOT (Left Leg)
        const dot = document.createElement('div');
        dot.className = 'frog-dot';
        // Add half PPI to center dot in the "cell" visually
        dot.style.left = `${frogX + (PPI/2)}px`;
        dot.style.top = `${frogY + (PPI/2)}px`;
        container.appendChild(dot);

        // 2. Draw PRODUCT BOX
        // Frog spans 2 holes (C and C+1).
        // Product is centered between these two holes.
        // Center X = frogX + (0.5 inches in pixels)
        const centerX = frogX + (PPI/2) + (PPI/2); 
        
        // Box Top-Left calculations
        const boxLeft = centerX - (wPxItem / 2);
        const boxTop = frogY + (PPI/2); // Hangs from the row center

        const box = document.createElement('div');
        box.className = 'product-box';
        box.style.width = `${wPxItem}px`;
        box.style.height = `${hPxItem}px`;
        box.style.left = `${boxLeft}px`;
        box.style.top = `${boxTop}px`;
        
        // Data
        const cleanUPC = item.CleanUPC;
        box.dataset.upc = cleanUPC;
        
        if(completedItems.has(cleanUPC)) {
            box.classList.add('completed');
            complete++;
        }

        // Image Search (Raw UPC Match)
        const imgName = fileIndex.find(f => f.startsWith(item.UPC));
        if(imgName) {
            const img = document.createElement('img');
            img.src = imgName; 
            img.loading = "lazy";
            box.appendChild(img);
        } else {
            box.innerHTML = `<span style="font-size:9px; text-align:center;">${item.UPC}</span>`;
        }

        box.onclick = () => toggleComplete(cleanUPC, box);
        container.appendChild(box);
    });

    updateProgress(complete, items.length);
}

function getPegCoords(str) {
    if(!str) return {r:1,c:1};
    const m = str.match(/R(\d+)\s*C(\d+)/);
    if(m) return { r: parseInt(m[1]), c: parseInt(m[2]) };
    return {r:1,c:1};
}

// ==========================================
// LOGIC
// ==========================================
function toggleComplete(upc, el) {
    if(completedItems.has(upc)) {
        completedItems.delete(upc);
        el.classList.remove('completed');
    } else {
        completedItems.add(upc);
        el.classList.add('completed');
    }
    localStorage.setItem('harpa_complete', JSON.stringify([...completedItems]));
    
    // Recalc
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
// SWIPE
// ==========================================
function setupSwipe() {
    let startX = 0;
    const el = document.getElementById('main-scroll-area');
    el.addEventListener('touchstart', e => startX = e.changedTouches[0].screenX, {passive:true});
    el.addEventListener('touchend', e => {
        const diff = e.changedTouches[0].screenX - startX;
        if(Math.abs(diff) > 60) {
            if(diff > 0) changeBay(-1);
            else changeBay(1);
        }
    }, {passive:true});
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
        (decodedText) => {
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
        }).catch(()=>{
            document.getElementById('scanner-modal').classList.add('hidden');
        });
    } else {
        document.getElementById('scanner-modal').classList.add('hidden');
    }
}

function handleSearchOrScan(inputVal) {
    if(!inputVal) return;
    
    const clean = normalizeUPC(inputVal);
    document.getElementById('scan-debug').innerText = `Scanned: ${inputVal} -> ${clean}`;

    // 1. Search Globally in Current POG
    const match = pogData.find(i => i.POG === currentPOG && i.CleanUPC === clean);

    if(!match) {
        document.getElementById('scan-debug').innerText += " [NOT FOUND]";
        return;
    }

    // 2. Check Bay
    const matchBay = parseInt(match.Bay);
    if(matchBay !== currentBay) {
        loadBay(matchBay);
        setTimeout(() => highlightItem(clean), 400);
    } else {
        highlightItem(clean);
    }
}

function highlightItem(upc) {
    const box = document.querySelector(`.product-box[data-upc="${upc}"]`);
    if(box) {
        box.scrollIntoView({behavior:"smooth", block:"center"});
        box.classList.add('highlight');
        if(!box.classList.contains('completed')) {
            toggleComplete(upc, box);
        }
        setTimeout(() => box.classList.remove('highlight'), 2000);
    }
}

// ==========================================
// PDF
// ==========================================
function openPDF() {
    if(!currentPOG) return;
    const pdf = fileIndex.find(f => f.includes(currentPOG) && f.endsWith('.pdf'));
    if(pdf) {
        document.getElementById('pdf-frame').src = pdf;
        document.getElementById('pdf-modal').classList.remove('hidden');
    } else {
        alert("No PDF found for POG " + currentPOG);
    }
}
function closePDF() {
    document.getElementById('pdf-modal').classList.add('hidden');
    document.getElementById('pdf-frame').src = "";
}
