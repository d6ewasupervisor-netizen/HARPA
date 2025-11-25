// --- CONFIGURATION ---
const REPO_BASE = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + "/";
const SCALE = 14; // Pixels per inch (Matches CSS background-size)
// Physical dimensions in holes (4ft wide x standard height)
const BOARD_W_HOLES = 48; 
const BOARD_H_HOLES = 72; 

// --- GLOBAL STATE ---
let fileIndex = [];
let pogData = [];
let storeMap = [];
let currentStore = null;
let currentPOG = null;
let currentBay = 1;
let allBays = [];
let html5QrCode = null;
let completedItems = new Set(JSON.parse(localStorage.getItem('harpa_complete') || "[]"));

// --- HELPER: STRIP LEADING ZEROS ---
function normalizeUPC(upc) {
    if (!upc) return "";
    // Convert to string, trim whitespace, remove ALL leading zeros
    return upc.toString().trim().replace(/^0+/, '');
}

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
    
    // Manual Search Button
    document.getElementById('btn-manual-search').onclick = () => {
        const val = document.getElementById('search-input').value.trim();
        if(val) handleSearchOrScan(val);
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
    
    main.addEventListener('touchstart', e => touchStartX = e.changedTouches[0].screenX, {passive: true});
    main.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleGesture();
    }, {passive: true});

    function handleGesture() {
        const diff = touchEndX - touchStartX;
        if (Math.abs(diff) > 50) { 
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
    storeMap = parseCSV(mapText);
    
    // Parse POG Data and Pre-Normalize UPCs
    const rawPogData = parseCSV(pogText);
    pogData = rawPogData.map(item => {
        // Add a 'CleanUPC' property to every item for easy matching later
        item.CleanUPC = normalizeUPC(item.UPC);
        return item;
    });
}

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const headers = lines[0].split(',').map(h => h.trim());
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        // Handle simple CSV splitting
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
    // Sort bays numerically
    allBays = [...new Set(pogItems.map(i => parseInt(i.Bay)))].sort((a,b)=>a-b);
    
    if(allBays.length === 0) return alert("No bays found for POG " + currentPOG);

    document.getElementById('store-modal').classList.add('hidden');
    document.getElementById('store-display').innerText = `Store #${storeNum}`;
    document.getElementById('pog-display').innerText = `POG: ${currentPOG}`;
    document.getElementById('error-msg').classList.add('hidden');

    // Load the first available bay
    loadBay(allBays[0]);
}

function resetStore() {
    localStorage.removeItem('harpa_store');
    location.reload();
}

// --- BAY NAVIGATION ---
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
    
    document.getElementById('prev-bay-btn').disabled = (bayNum === allBays[0]);
    document.getElementById('next-bay-btn').disabled = (bayNum === allBays[allBays.length - 1]);

    renderGrid(bayNum);
}

// --- RENDERER ---
function renderGrid(bayNum) {
    const container = document.getElementById('grid-view-container');
    container.innerHTML = '';

    // 1. Auto-Scale to Screen Width
    const screenWidth = document.getElementById('main-container').clientWidth;
    const usableWidth = screenWidth - 10; // Padding
    
    // Calculate PPI based on 4ft (48 inches) fitting on screen
    // Use global variable for use in click handlers if needed
    let renderPPI = usableWidth / 48; 
    
    // Dimensions
    const boardW = 48 * renderPPI;
    const boardH = 72 * renderPPI;

    container.style.width = `${boardW}px`;
    container.style.height = `${boardH}px`;
    container.style.backgroundSize = `${renderPPI}px ${renderPPI}px`;

    // 2. Get Items
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
    let complete = 0;

    items.forEach(item => {
        // Parse Coords
        const { r, c } = getCoords(item.Peg);
        const h = parseFloat(item.Height.replace(' in','')) || 6;
        const w = parseFloat(item.Width.replace(' in','')) || 3;

        // Positioning
        const frogX = (c - 1) * renderPPI;
        const frogY = (r - 1) * renderPPI;

        // Frog Dot
        const frog = document.createElement('div');
        frog.className = 'frog-dot';
        frog.style.left = `${frogX + (renderPPI/2)}px`;
        frog.style.top = `${frogY + (renderPPI/2)}px`;
        container.appendChild(frog);

        // Product Box (Centered between hole C and C+1)
        const spanCenterX = frogX + renderPPI; // 1 inch to the right
        const boxLeft = spanCenterX - ((w * renderPPI)/2);
        const boxTop = frogY + (renderPPI/2);

        const box = document.createElement('div');
        box.className = 'product-box';
        box.style.width = `${w * renderPPI}px`;
        box.style.height = `${h * renderPPI}px`;
        box.style.left = `${boxLeft}px`;
        box.style.top = `${boxTop}px`;

        // Use CleanUPC for matching
        const clean = item.CleanUPC; 
        box.dataset.upc = clean;
        box.dataset.desc = item.ProductDescription.toLowerCase();

        if(completedItems.has(clean)) {
            box.classList.add('completed');
            complete++;
        }

        // Image finding (using raw UPC start match to handle filename variance)
        // But search file index using raw UPC logic
        const imgName = fileIndex.find(f => f.startsWith(item.UPC));
        if(imgName) {
            const img = document.createElement('img');
            img.src = imgName;
            box.appendChild(img);
        } else {
            box.innerHTML = `<span style="font-size:${renderPPI/2.5}px; text-align:center; padding:1px;">${item.UPC}</span>`;
        }

        box.onclick = () => toggleComplete(clean, box);
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

// --- COMPLETION LOGIC ---
function toggleComplete(cleanUpc, el) {
    if(completedItems.has(cleanUpc)) {
        completedItems.delete(cleanUpc);
        if(el) el.classList.remove('completed');
    } else {
        completedItems.add(cleanUpc);
        if(el) el.classList.add('completed');
    }
    localStorage.setItem('harpa_complete', JSON.stringify([...completedItems]));
    
    // Recalculate stats
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
    const done = items.filter(i => completedItems.has(i.CleanUPC)).length;
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
    document.getElementById('scanner-modal').classList.remove('hidden');
    
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" }, 
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            handleSearchOrScan(decodedText);
            // We don't close scanner automatically anymore, user must close manually or keep scanning
        },
        (errorMessage) => {}
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

function handleSearchOrScan(rawInput) {
    // 1. Normalize Input
    const cleanInput = normalizeUPC(rawInput);
    
    // 2. Update Debug Display
    document.getElementById('last-scanned-code').innerHTML = `Raw: ${rawInput} <br> Clean: ${cleanInput}`;

    // 3. Global Search in current POG (All Bays)
    // We search by CleanUPC
    const match = pogData.find(i => i.POG === currentPOG && i.CleanUPC === cleanInput);

    if(!match) {
        // Audio feedback for failure?
        return; 
    }

    // 4. Check Bay
    const matchBay = parseInt(match.Bay);
    if (matchBay !== currentBay) {
        // Auto-switch bay
        loadBay(matchBay);
        // Delay highlight to allow render
        setTimeout(() => highlightItem(cleanInput), 500);
    } else {
        highlightItem(cleanInput);
    }
}

function highlightItem(cleanUpc) {
    // Find box by dataset attribute
    const box = document.querySelector(`.product-box[data-upc="${cleanUpc}"]`);
    
    if(box) {
        box.scrollIntoView({behavior: "smooth", block: "center"});
        box.classList.add('highlight');
        
        // Auto-Complete on Scan
        if(!box.classList.contains('completed')) {
            toggleComplete(cleanUpc, box);
        }

        // Remove highlight after 2 seconds
        setTimeout(() => box.classList.remove('highlight'), 2000);
    }
}

// --- PDF ---
function openPDF() {
    if(!currentPOG) return alert("Select store first.");
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
