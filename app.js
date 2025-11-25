// ==========================================
// CONFIGURATION
// ==========================================
const REPO_BASE = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + "/";
const IMG_PATH = ""; 

// PHYSICAL DIMENSIONS (HOLES)
const BOARD_W_HOLES = 46; 
const BOARD_HEIGHT_HOLES = 64; // Defined here for use in render

// ==========================================
// GLOBAL STATE
// ==========================================
let PPI = 16; // Will be auto-calculated
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
        safeSetText('loading-text', "Data Loaded");
        document.getElementById('loading-overlay').classList.add('hidden');

        const savedStore = localStorage.getItem('harpa_store');
        if (savedStore) {
            loadStoreLogic(savedStore);
        } else {
            document.getElementById('store-modal').classList.remove('hidden');
        }
    } catch (error) {
        alert("Data Load Error: " + error.message);
    }

    // Inputs
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

// Helper to avoid "property of null" errors
function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

// ==========================================
// DATA HANDLING
// ==========================================
async function loadCSVData() {
    const ts = new Date().getTime(); 
    const [filesReq, pogReq, mapReq] = await Promise.all([
        fetch(`githubfiles.csv?t=${ts}`),
        fetch(`allplanogramdata.csv?t=${ts}`),
        fetch(`Store_POG_Mapping.csv?t=${ts}`)
    ]);

    if (!filesReq.ok || !pogReq.ok || !mapReq.ok) throw new Error("Failed to fetch CSV files");

    const filesText = await filesReq.text();
    const pogText = await pogReq.text();
    const mapText = await mapReq.text();

    fileIndex = filesText.split('\n').map(l => l.trim());
    storeMap = parseCSV(mapText);
    
    // Parse POG and pre-calculate clean UPCs
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
    
    if (allBays.length === 0) return alert("POG " + currentPOG + " has no items.");

    document.getElementById('store-modal').classList.add('hidden');
    safeSetText('store-display', `Store #${storeNum}`);
    safeSetText('pog-display', `POG: ${currentPOG}`);
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
    safeSetText('bay-indicator', `Bay ${bayNum} of ${allBays.length}`);
    
    document.getElementById('prev-bay').style.opacity = (bayNum === allBays[0]) ? "0.3" : "1";
    document.getElementById('next-bay').style.opacity = (bayNum === allBays[allBays.length - 1]) ? "0.3" : "1";

    renderPegboard(bayNum);
}

// ==========================================
// RENDERER
// ==========================================
function renderPegboard(bayNum) {
    const container = document.getElementById('pegboard-container');
    container.innerHTML = '';

    // 1. Calculate Scale (Pixels Per Inch) to fit screen
    const screenWidth = document.getElementById('main-scroll-area').clientWidth;
    // We want the 46-hole width to fit with small margin
    PPI = (screenWidth - 20) / BOARD_WIDTH_HOLES;
    
    // Enforce minimum visibility
    if(PPI < 7) PPI = 7; 

    const wPx = BOARD_WIDTH_HOLES * PPI;
    const hPx = BOARD_HEIGHT_HOLES * PPI;
    
    container.style.width = `${wPx}px`;
    container.style.height = `${hPx}px`;

    // 2. Draw Grid Dots (CSS)
    container.style.backgroundSize = `${PPI}px ${PPI}px`;
    // Visual dots: Black, 20% radius, on gray bg
    container.style.backgroundImage = `radial-gradient(circle, #000 15%, transparent 16%)`;

    // 3. Filter Items
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
    let complete = 0;

    items.forEach(item => {
        const { r, c } = getCoords(item.Peg);
        const cleanUPC = item.CleanUPC;
        
        // Dimensions
        const h = parseFloat(item.Height.replace(' in','')) || 6;
        const w = parseFloat(item.Width.replace(' in','')) || 3;
        const hPxItem = h * PPI;
        const wPxItem = w * PPI;

        // --- POSITIONS ---
        // Hole (C, R) is Left Leg. (1-based)
        const frogX = (c - 1) * PPI;
        const frogY = (r - 1) * PPI;

        // Red Dot
        const dot = document.createElement('div');
        dot.className = 'frog-dot';
        // Center dot in the "cell"
        dot.style.left = `${frogX + (PPI/2)}px`;
        dot.style.top = `${frogY + (PPI/2)}px`;
        container.appendChild(dot);

        // Product Box
        // Centered between Hole C and Hole C+1 (Right Leg)
        // Midpoint is X + PPI/2
        const centerXPx = frogX + (PPI/2) + (PPI/2);
        
        const boxLeft = centerXPx - (wPxItem / 2);
        const boxTop = frogY + (PPI/2); // Hangs from row center

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

        // Image
        const imgName = fileIndex.find(f => f.startsWith(item.UPC));
        if (imgName) {
            const img = document.createElement('img');
            img.src = imgName;
            img.loading = "lazy";
            box.appendChild(img);
        } else {
            box.innerHTML = `<span style="font-size:${Math.max(9, PPI/2)}px; text-align:center; padding:1px;">${item.UPC}</span>`;
        }

        box.onclick = () => toggleComplete(cleanUPC, box);
        container.appendChild(box);
    });

    updateProgress(complete, items.length);
}

function getCoords(str) {
    if(!str) return {r:1, c:1};
    const m = str.match(/R(\d+)\s*C(\d+)/);
    if(m) return { r: parseInt(m[1]), c: parseInt(m[2]) };
    return { r: 1, c: 1 };
}

// ==========================================
// LOGIC
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
    
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
    const done = items.filter(i => completedItems.has(i.CleanUPC)).length;
    updateProgress(done, items.length);
}

function updateProgress(done, total) {
    const pct = total > 0 ? Math.round((done/total)*100) : 0;
    document.getElementById('progress-fill').style.width = `${pct}%`;
    safeSetText('progress-count', `${done} / ${total} (${pct}%)`);
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
        alert("Camera Error. Ensure HTTPS is on. " + err);
        stopScanner();
    });
}

function stopScanner() {
    if(html5QrCode) {
        html5QrCode.stop().then(() => {
            document.getElementById('scanner-modal').classList.add('hidden');
            html5QrCode.clear();
        });
    } else {
        document.getElementById('scanner-modal').classList.add('hidden');
    }
}

function handleSearchOrScan(inputVal) {
    if(!inputVal) return;
    
    // normalize input (strip zeros)
    const cleanInput = normalizeUPC(inputVal);
    safeSetText('scan-debug', `Scanned: ${inputVal} -> ${cleanInput}`);

    // Search
    const match = pogData.find(i => i.POG === currentPOG && i.CleanUPC === cleanInput);

    if(!match) {
        document.getElementById('scan-debug').style.color = "red";
        document.getElementById('scan-debug').innerText += " [NOT FOUND]";
        return;
    }
    
    document.getElementById('scan-debug').style.color = "green";
    document.getElementById('scan-debug').innerText += " [OK]";

    // Check Bay
    const bay = parseInt(match.Bay);
    if(bay !== currentBay) {
        loadBay(bay);
        setTimeout(() => highlightItem(cleanInput), 400);
    } else {
        highlightItem(cleanInput);
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
    let startX = 0;
    const el = document.getElementById('main-scroll-area');
    el.addEventListener('touchstart', e => startX = e.changedTouches[0].screenX, {passive:true});
    el.addEventListener('touchend', e => {
        const diff = e.changedTouches[0].screenX - startX;
        if(Math.abs(diff) > 70) {
            if(diff > 0) changeBay(-1);
            else changeBay(1);
        }
    }, {passive:true});
}

function openPDF() {
    if(!currentPOG) return alert("Load store first");
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
