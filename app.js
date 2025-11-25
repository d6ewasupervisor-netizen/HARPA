// ==========================================
// CONFIGURATION
// ==========================================
// Base URL for fetching files
const REPO_BASE = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + "/";

// PHYSICAL DIMENSIONS (HOLES)
// The board is exactly 46 holes wide x 64 holes high
const BOARD_WIDTH_HOLES = 46; 
const BOARD_HEIGHT_HOLES = 64;

// ==========================================
// GLOBAL STATE
// ==========================================
let PPI = 16; // Pixels Per Inch (Will be auto-calculated)
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
        alert("Error: " + error.message);
    }

    // Bind Buttons
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
// DATA LOADING
// ==========================================
async function loadCSVData() {
    const ts = new Date().getTime(); // Cache busting
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
    
    // Pre-normalize UPCs in memory
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
    // Remove whitespace and ALL leading zeros
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

    // Find bays for this POG
    const items = pogData.filter(i => i.POG === currentPOG);
    allBays = [...new Set(items.map(i => parseInt(i.Bay)))].sort((a,b) => a-b);
    
    if (allBays.length === 0) return alert("POG " + currentPOG + " has no items.");

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

    // 1. CALCULATE SCALE (Fit to Screen Width)
    const screenWidth = document.getElementById('main-scroll-area').clientWidth;
    // We need 46 holes to fit in width. Add 10px padding.
    PPI = (screenWidth - 20) / BOARD_WIDTH_HOLES;
    
    const wPx = BOARD_WIDTH_HOLES * PPI;
    const hPx = BOARD_HEIGHT_HOLES * PPI;
    
    container.style.width = `${wPx}px`;
    container.style.height = `${hPx}px`;

    // 2. Visual Grid (Dots)
    const bg = document.createElement('div');
    bg.className = 'peg-hole-pattern';
    bg.style.backgroundSize = `${PPI}px ${PPI}px`;
    // Draw black dot in center of each grid cell
    bg.style.backgroundImage = `radial-gradient(circle, #000 15%, transparent 16%)`;
    container.appendChild(bg);

    // 3. Filter Items
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
    let complete = 0;

    items.forEach(item => {
        const { r, c } = getCoords(item.Peg);
        
        // Convert Dimensions
        const h = parseFloat(item.Height.replace(' in','')) || 6;
        const w = parseFloat(item.Width.replace(' in','')) || 3;
        const hPxItem = h * PPI;
        const wPxItem = w * PPI;

        // --- FROG POSITIONING ---
        // (1,1) is top-left.
        // Hole C X = (C-1)*PPI
        // Hole R Y = (R-1)*PPI
        
        const frogX = (c - 1) * PPI;
        const frogY = (r - 1) * PPI;

        // 1. Draw RED DOT (The Left Leg of Frog)
        const dot = document.createElement('div');
        dot.className = 'frog-dot';
        // Add half PPI to center visually in the hole space
        dot.style.left = `${frogX + (PPI/2)}px`;
        dot.style.top = `${frogY + (PPI/2)}px`;
        container.appendChild(dot);

        // 2. Draw PRODUCT BOX
        // Frog spans 2 holes (C and C+1). Product centered between them.
        // Center X = frogX + (0.5 inches * PPI) + (0.5 inches * PPI) -> One full PPI shift to the right center?
        // No, Frog is Left Leg. Center of product is between Left Leg (C) and Right Leg (C+1).
        // Distance is 1 inch (PPI). Midpoint is +0.5*PPI relative to Left Hole Center.
        
        const leftHoleCenterX = frogX + (PPI/2);
        const productCenterX = leftHoleCenterX + (PPI/2); // Half inch to the right
        
        const boxLeft = productCenterX - (wPxItem / 2);
        const boxTop = frogY + (PPI/2); // Hangs from row center

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

        // Image Logic
        const imgName = fileIndex.find(f => f.startsWith(item.UPC));
        if (imgName) {
            const img = document.createElement('img');
            img.src = imgName;
            img.loading = "lazy";
            box.appendChild(img);
        } else {
            // Fallback text if no image found
            box.innerText = item.UPC;
            box.style.fontSize = `${PPI*0.4}px`;
            box.style.textAlign = "center";
            box.style.display = "flex";
            box.style.alignItems = "center";
            box.style.justifyContent = "center";
            box.style.overflow = "hidden";
            box.style.wordBreak = "break-all";
        }

        box.onclick = () => toggleComplete(item.CleanUPC, box);
        container.appendChild(box);
    });

    // Progress
    const pct = items.length ? Math.round((complete/items.length)*100) : 0;
    document.getElementById('progress-fill').style.width = `${pct}%`;
    document.getElementById('progress-count').innerText = `${complete} / ${items.length}`;
}

function getCoords(str) {
    if(!str) return {r:1, c:1};
    const m = str.match(/R(\d+)\s*C(\d+)/);
    if(m) return { r: parseInt(m[1]), c: parseInt(m[2]) };
    return { r: 1, c: 1 };
}

// ==========================================
// COMPLETION LOGIC
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
    
    // Update stats simply by counting DOM elements for performance
    const allBoxes = document.querySelectorAll('.product-box');
    const completeBoxes = document.querySelectorAll('.product-box.completed');
    const pct = Math.round((completeBoxes.length / allBoxes.length) * 100);
    document.getElementById('progress-fill').style.width = `${pct}%`;
    document.getElementById('progress-count').innerText = `${completeBoxes.length} / ${allBoxes.length}`;
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
        (decodedText) => {
            // Do NOT close scanner automatically
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
        }).catch(() => {
            document.getElementById('scanner-modal').classList.add('hidden');
        });
    } else {
        document.getElementById('scanner-modal').classList.add('hidden');
    }
}

function handleSearchOrScan(inputVal) {
    if(!inputVal) return;
    
    const clean = normalizeUPC(inputVal);
    document.getElementById('scan-debug').innerHTML = `Scan: <b>${inputVal}</b> | Clean: <b>${clean}</b>`;

    // 1. Search GLOBAL
    const match = pogData.find(i => i.POG === currentPOG && i.CleanUPC === clean);

    if(!match) {
        document.getElementById('scan-debug').style.color = "red";
        document.getElementById('scan-debug').innerHTML += " [Not Found]";
        return;
    }

    document.getElementById('scan-debug').style.color = "green";
    document.getElementById('scan-debug').innerHTML += " [Found]";

    // 2. Switch Bay if needed
    const bay = parseInt(match.Bay);
    if(bay !== currentBay) {
        loadBay(bay);
        // Delay to allow DOM render
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
// SWIPE & PDF
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
