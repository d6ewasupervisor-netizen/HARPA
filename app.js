// --- CONFIGURATION ---
const REPO_BASE = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + "/";
const IMG_PATH = "images/"; // Ensure this matches your folder name if any
const BOARD_W_HOLES = 46;   // 4ft section = 46 holes available horizontally
const BOARD_H_HOLES = 64;   // Vertical holes

// --- GLOBAL STATE ---
let PPI = 0; // Will be calculated based on screen width
let fileIndex = [];
let pogData = [];
let storeMap = [];
let currentStore = null;
let currentPOG = null;
let currentBay = 1;
let allBays = [];
let html5QrCode = null;
let completedItems = new Set(JSON.parse(localStorage.getItem('harpa_complete') || "[]"));

// --- INITIALIZATION ---
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
        alert("Error loading data: " + error.message);
    }

    // Buttons
    document.getElementById('btn-load-store').onclick = () => {
        loadStoreLogic(document.getElementById('store-input').value.trim());
    };
    document.getElementById('btn-scan-toggle').onclick = startScanner;
    document.getElementById('btn-manual-search').onclick = () => {
        handleSearchOrScan(document.getElementById('search-input').value.trim());
    };
    
    // Nav Arrows
    document.getElementById('prev-bay-btn').onclick = () => changeBay(-1);
    document.getElementById('next-bay-btn').onclick = () => changeBay(1);
}

// --- SWIPE LOGIC ---
function setupSwipe() {
    let touchStartX = 0;
    let touchEndX = 0;
    
    const main = document.getElementById('main-container');
    
    main.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
    }, {passive: true});

    main.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleGesture();
    }, {passive: true});

    function handleGesture() {
        const diff = touchEndX - touchStartX;
        if (Math.abs(diff) > 50) { // Minimum swipe distance
            if (diff > 0) changeBay(-1); // Swipe Right -> Prev
            else changeBay(1); // Swipe Left -> Next
        }
    }
}

// --- DATA LOADING ---
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
    pogData = parseCSV(pogText);
    storeMap = parseCSV(mapText);
}

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const headers = lines[0].split(',').map(h => h.trim());
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        // Simple split: assumes no commas within cells
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

// --- STORE LOGIC ---
function loadStoreLogic(storeNum) {
    const mapping = storeMap.find(s => s.Store === storeNum);
    if (!mapping) {
        document.getElementById('error-msg').classList.remove('hidden');
        return;
    }
    currentStore = storeNum;
    currentPOG = mapping.POG;
    localStorage.setItem('harpa_store', storeNum);
    
    // Determine Available Bays
    const pogItems = pogData.filter(i => i.POG === currentPOG);
    allBays = [...new Set(pogItems.map(i => parseInt(i.Bay)))].sort((a,b)=>a-b);
    
    if(allBays.length === 0) return alert("No bays found for POG " + currentPOG);

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

// --- BAY LOGIC ---
function changeBay(dir) {
    const idx = allBays.indexOf(currentBay);
    if(idx === -1) return;
    
    let newIdx = idx + dir;
    if(newIdx < 0) newIdx = 0;
    if(newIdx >= allBays.length) newIdx = allBays.length - 1;
    
    if(allBays[newIdx] !== currentBay) {
        loadBay(allBays[newIdx]);
    }
}

function loadBay(bayNum) {
    currentBay = bayNum;
    document.getElementById('bay-indicator').innerText = `Bay ${bayNum} of ${allBays.length}`;
    
    // Disable arrows if at ends
    document.getElementById('prev-bay-btn').disabled = (bayNum === allBays[0]);
    document.getElementById('next-bay-btn').disabled = (bayNum === allBays[allBays.length - 1]);

    renderGrid(bayNum);
}

// --- RENDERER (FIT TO SCREEN) ---
function renderGrid(bayNum) {
    const container = document.getElementById('grid-view-container');
    container.innerHTML = '';

    // 1. Calculate Scale to Fit Screen Width
    // We want 48 inches (4ft bay) to fit in the main container width
    const screenWidth = document.getElementById('main-container').clientWidth;
    // Subtract small padding
    const usableWidth = screenWidth - 20; 
    PPI = usableWidth / 48; // Dynamic PPI

    // 2. Set Board Dimensions
    const boardW = 48 * PPI;
    const boardH = 72 * PPI; // 6ft high

    container.style.width = `${boardW}px`;
    container.style.height = `${boardH}px`;
    
    // CSS Grid Background size
    container.style.backgroundSize = `${PPI}px ${PPI}px`;

    // 3. Get Items
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
    let complete = 0;

    items.forEach(item => {
        const { r, c } = getCoords(item.Peg);
        const h = parseFloat(item.Height.replace(' in','')) || 6;
        const w = parseFloat(item.Width.replace(' in','')) || 3;

        // Position Logic: (1,1) is Top Left
        // Frog x = Column * PPI. Frog y = Row * PPI
        const frogX = (c - 1) * PPI;
        const frogY = (r - 1) * PPI;

        // Draw Frog
        const frog = document.createElement('div');
        frog.className = 'frog-dot';
        // Center in the hole
        frog.style.left = `${frogX + (PPI/2)}px`;
        frog.style.top = `${frogY + (PPI/2)}px`;
        container.appendChild(frog);

        // Draw Product
        // Product Center X = Frog Center X + (0.5 inch offset for middle of holes)
        // Actually user said frog spans 2 holes. Product centered between them.
        const frogCenterX = frogX + (PPI / 2); // Midpoint of left hole
        const spanCenterX = frogCenterX + (PPI / 2); // Midpoint between hole C and C+1
        
        const boxLeft = spanCenterX - ((w * PPI)/2);
        const boxTop = frogY + (PPI/2);

        const box = document.createElement('div');
        box.className = 'product-box';
        box.style.width = `${w * PPI}px`;
        box.style.height = `${h * PPI}px`;
        box.style.left = `${boxLeft}px`;
        box.style.top = `${boxTop}px`;

        const cleanUPC = normalizeUPC(item.UPC);
        box.dataset.upc = cleanUPC;
        box.dataset.bay = item.Bay;

        if(completedItems.has(cleanUPC)) {
            box.classList.add('completed');
            complete++;
        }

        // Image
        const imgName = fileIndex.find(f => f.startsWith(item.UPC));
        if(imgName) {
            const img = document.createElement('img');
            img.src = imgName;
            box.appendChild(img);
        } else {
            box.innerHTML = `<span style="font-size:${PPI/2.5}px; text-align:center;">${item.UPC}</span>`;
        }

        box.onclick = () => toggleComplete(cleanUPC, box);
        container.appendChild(box);
    });

    updateProgress(complete, items.length);
}

function getCoords(pegStr) {
    if(!pegStr) return {r:1, c:1};
    const m = pegStr.match(/R(\d+)\s*C(\d+)/);
    if(m) return { r: parseInt(m[1]), c: parseInt(m[2]) };
    return { r: 1, c: 1 };
}

// --- LOGIC ---
function normalizeUPC(upc) {
    if(!upc) return "";
    // Remove all leading zeros
    return upc.toString().replace(/^0+/, '');
}

function toggleComplete(upc, el) {
    if(completedItems.has(upc)) {
        completedItems.delete(upc);
        if(el) el.classList.remove('completed');
    } else {
        completedItems.add(upc);
        if(el) el.classList.add('completed');
    }
    localStorage.setItem('harpa_complete', JSON.stringify([...completedItems]));
    
    // Update stats
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
    const done = items.filter(i => completedItems.has(normalizeUPC(i.UPC))).length;
    updateProgress(done, items.length);
}

function updateProgress(done, total) {
    const pct = total > 0 ? Math.round((done/total)*100) : 0;
    document.getElementById('progress-bar').style.width = `${pct}%`;
    document.getElementById('progress-count').innerText = `${done} / ${total}`;
}

function loadProgress() {
    const s = localStorage.getItem('harpa_complete');
    if(s) completedItems = new Set(JSON.parse(s));
}

// --- SCANNER & SEARCH ---
function startScanner() {
    const modal = document.getElementById('scanner-modal');
    modal.classList.remove('hidden');

    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" }, 
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            // 1. Display the raw scan for debugging
            document.getElementById('last-scanned-code').innerText = decodedText;
            // 2. Process
            stopScanner();
            handleSearchOrScan(decodedText);
        },
        (errorMessage) => {}
    ).catch(err => {
        alert("Camera Error: " + err);
        modal.classList.add('hidden');
    });
}

function stopScanner() {
    if(html5QrCode) {
        html5QrCode.stop().then(() => {
            document.getElementById('scanner-modal').classList.add('hidden');
            html5QrCode.clear();
        }).catch(e => { 
            document.getElementById('scanner-modal').classList.add('hidden'); 
        });
    }
}

function handleSearchOrScan(rawInput) {
    if(!rawInput) return;

    const normalizedInput = normalizeUPC(rawInput);
    document.getElementById('last-scanned-code').innerText = `${rawInput} -> ${normalizedInput}`;

    // 1. Search GLOBAL POG Data (All Bays)
    const match = pogData.find(i => i.POG === currentPOG && normalizeUPC(i.UPC) === normalizedInput);

    if(!match) {
        alert(`Item ${rawInput} not found in Planogram ${currentPOG}.`);
        return;
    }

    const matchBay = parseInt(match.Bay);

    // 2. If in different bay, switch
    if (matchBay !== currentBay) {
        loadBay(matchBay);
        // Small delay to allow DOM render
        setTimeout(() => highlightItem(normalizedInput), 300);
    } else {
        highlightItem(normalizedInput);
    }
}

function highlightItem(upc) {
    const box = document.querySelector(`.product-box[data-upc="${upc}"]`);
    if(box) {
        // Scroll to it
        box.scrollIntoView({behavior: "smooth", block: "center"});
        // Highlight style
        box.classList.add('highlight');
        // Auto-complete
        if(!box.classList.contains('completed')) {
            toggleComplete(upc, box);
        }
        // Remove highlight after 2s
        setTimeout(() => box.classList.remove('highlight'), 2000);
    }
}

// --- PDF ---
function openPDF() {
    if(!currentPOG) return;
    const pdfName = fileIndex.find(f => f.includes(currentPOG) && f.endsWith('.pdf'));
    if(pdfName) {
        document.getElementById('pdf-frame').src = pdfName;
        document.getElementById('pdf-modal').classList.remove('hidden');
    } else {
        alert("PDF not found.");
    }
}
function closePDF() {
    document.getElementById('pdf-modal').classList.add('hidden');
    document.getElementById('pdf-frame').src = "";
}
