// --- CONFIGURATION ---
// Screen Logic: 16 pixels = 1 inch on the pegboard
const PPI = 16; 
// Board Dimensions in holes (inches)
const BOARD_W_HOLES = 46; 
const BOARD_H_HOLES = 64;

// --- GLOBAL STATE ---
let fileIndex = []; // List of all images/PDFs in repo
let pogData = [];   // Product data
let storeMap = [];  // Store mapping
let currentStore = null;
let currentPOG = null;
let currentBay = null;
let html5QrCode = null;
let completedItems = new Set(JSON.parse(localStorage.getItem('harpa_complete') || "[]"));

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    try {
        // 1. Load all CSV data from Repo
        await loadCSVData();
        document.getElementById('loading-overlay').classList.add('hidden');

        // 2. Check for existing session
        const savedStore = localStorage.getItem('harpa_store');
        if (savedStore) {
            loadStoreLogic(savedStore);
        } else {
            document.getElementById('store-modal').classList.remove('hidden');
        }
    } catch (error) {
        alert("Error loading data: " + error.message);
    }

    // 3. Event Listeners
    document.getElementById('btn-load-store').addEventListener('click', () => {
        const val = document.getElementById('store-input').value.trim();
        if (val) loadStoreLogic(val);
    });

    document.getElementById('btn-scan-toggle').addEventListener('click', startScanner);
    document.getElementById('search-input').addEventListener('input', handleSearch);
}

// --- DATA FETCHING ---
async function loadCSVData() {
    const ts = new Date().getTime(); // Cache busting
    const [filesReq, pogReq, mapReq] = await Promise.all([
        fetch(`githubfiles.csv?t=${ts}`),
        fetch(`allplanogramdata.csv?t=${ts}`),
        fetch(`Store_POG_Mapping.csv?t=${ts}`)
    ]);

    if (!filesReq.ok || !pogReq.ok || !mapReq.ok) throw new Error("Failed to fetch data files. Check repo.");

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
        // Simple comma split (assuming no commas in description fields for simplicity)
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
    currentPOG = mapping.POG; // e.g., "8386824"

    localStorage.setItem('harpa_store', storeNum);

    // UI Updates
    document.getElementById('store-modal').classList.add('hidden');
    document.getElementById('store-display').textContent = `Store #${storeNum}`;
    document.getElementById('pog-display').textContent = `POG: ${currentPOG}`;
    document.getElementById('error-msg').classList.add('hidden');

    renderBayNavigation();
}

function resetStore() {
    localStorage.removeItem('harpa_store');
    location.reload();
}

// --- NAVIGATION ---
function renderBayNavigation() {
    // Filter items belonging to this POG
    const currentItems = pogData.filter(i => i.POG === currentPOG);
    
    if (currentItems.length === 0) {
        alert("No items found for POG: " + currentPOG);
        return;
    }

    // Find unique bays
    const bays = [...new Set(currentItems.map(i => parseInt(i.Bay)))].sort((a, b) => a - b);

    const container = document.getElementById('bay-nav');
    container.innerHTML = '';

    bays.forEach((bay, index) => {
        const btn = document.createElement('button');
        btn.className = 'bay-btn';
        btn.innerText = `Bay ${bay}`;
        btn.onclick = () => loadBay(bay);
        container.appendChild(btn);

        if (index === 0) loadBay(bay);
    });
}

function loadBay(bayNum) {
    currentBay = bayNum;
    document.querySelectorAll('.bay-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText === `Bay ${bayNum}`);
    });
    renderGrid(bayNum);
}

// --- BOARD RENDERING (The Frog) ---
function renderGrid(bayNum) {
    const container = document.getElementById('grid-view-container');
    container.innerHTML = '';

    // 1. Setup Dimensions
    const boardWidthPx = BOARD_W_HOLES * PPI;
    const boardHeightPx = BOARD_H_HOLES * PPI;

    container.style.width = `${boardWidthPx}px`;
    container.style.height = `${boardHeightPx}px`;

    // 2. Get Items
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
    let completeCount = 0;

    items.forEach(item => {
        const { r, c } = getCoords(item.Peg);
        // Parse H/W (remove ' in')
        const h = parseFloat(item.Height.replace(' in', '')) || 6;
        const w = parseFloat(item.Width.replace(' in', '')) || 3;

        // --- COORDINATE MATH (The Frog Logic) ---
        // r = Row Hole (1-64) from Top
        // c = Col Hole (1-46) from Left
        // PPI = Pixels Per Inch (16)
        // Holes are 1 inch apart.
        
        // FROG LEFT LEG: Goes into (c, r)
        const frogX = (c - 1) * PPI; 
        const frogY = (r - 1) * PPI;

        // Draw Frog (Red Dot) - centered on the hole
        const frog = document.createElement('div');
        frog.className = 'frog-dot';
        frog.style.left = `${frogX + (PPI/2)}px`; 
        frog.style.top = `${frogY + (PPI/2)}px`;
        container.appendChild(frog);

        // PRODUCT BOX:
        // The frog spans 2 holes (C and C+1).
        // The product hangs centered between these two holes.
        // Center X = frogX + (0.5 inch converted to pixels)
        const centerXPx = frogX + (PPI / 2);
        
        // Product Left = CenterX - (ProductWidth / 2)
        const boxLeft = centerXPx - ((w * PPI) / 2);
        // Product Top = frogY + (0.5 inch down for hang)
        const boxTop = frogY + (PPI / 2);

        const box = document.createElement('div');
        box.className = 'product-box';
        box.style.width = `${w * PPI}px`;
        box.style.height = `${h * PPI}px`;
        box.style.left = `${boxLeft}px`;
        box.style.top = `${boxTop}px`;
        
        // Metadata
        box.dataset.upc = normalizeUPC(item.UPC);
        box.dataset.desc = item.ProductDescription.toLowerCase();

        if (completedItems.has(normalizeUPC(item.UPC))) {
            box.classList.add('completed');
            completeCount++;
        }

        // Image matching (Startswith UPC)
        const imgName = fileIndex.find(f => f.startsWith(item.UPC));
        if (imgName) {
            const img = document.createElement('img');
            img.src = imgName;
            img.loading = "lazy";
            box.appendChild(img);
        } else {
            box.innerHTML = `<span style="font-size:10px; text-align:center; padding:2px;">${item.UPC}</span>`;
        }

        box.onclick = () => toggleComplete(normalizeUPC(item.UPC), box);
        container.appendChild(box);
    });

    updateProgress(completeCount, items.length);
}

function getCoords(pegStr) {
    // "R02 C03" -> Row 2, Col 3
    if (!pegStr) return { r: 1, c: 1 };
    const match = pegStr.match(/R(\d+)\s*C(\d+)/);
    if (match) return { r: parseInt(match[1]), c: parseInt(match[2]) };
    return { r: 1, c: 1 };
}

// --- INTERACTION ---
function toggleComplete(upc, el) {
    if (completedItems.has(upc)) {
        completedItems.delete(upc);
        el.classList.remove('completed');
    } else {
        completedItems.add(upc);
        el.classList.add('completed');
    }
    localStorage.setItem('harpa_complete', JSON.stringify([...completedItems]));
    
    // Update progress math
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
    const done = items.filter(i => completedItems.has(normalizeUPC(i.UPC))).length;
    updateProgress(done, items.length);
}

function updateProgress(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    document.getElementById('progress-bar').style.width = `${pct}%`;
    document.getElementById('progress-count').innerText = `${done} / ${total}`;
}

function loadProgress() {
    const saved = localStorage.getItem('harpa_complete');
    if(saved) completedItems = new Set(JSON.parse(saved));
}

// --- SCANNER & SEARCH ---
function normalizeUPC(upc) {
    if(!upc) return "";
    // Remove leading zeros to ensure matches (e.g. 00414... becomes 414...)
    return upc.toString().replace(/^0+/, '');
}

function startScanner() {
    const modal = document.getElementById('scanner-modal');
    modal.classList.remove('hidden');

    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" }, 
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            stopScanner();
            handleScanMatch(decodedText);
        },
        (errorMessage) => {}
    ).catch(err => {
        alert("Camera Error: Ensure HTTPS is enabled and camera permissions granted.");
        modal.classList.add('hidden');
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

function handleScanMatch(scannedRaw) {
    const scanned = normalizeUPC(scannedRaw);
    
    // 1. Search entire Planogram
    const match = pogData.find(i => i.POG === currentPOG && normalizeUPC(i.UPC) === scanned);
    
    if (!match) {
        alert("Item not found in current Planogram.");
        return;
    }

    // 2. Check if in current Bay
    const itemBay = parseInt(match.Bay);
    if (itemBay !== currentBay) {
        if(confirm(`Item found in Bay ${itemBay}. Switch bays?`)) {
            loadBay(itemBay);
            // Allow render time before highlighting
            setTimeout(() => highlightItem(scanned), 500);
        }
        return;
    }

    highlightItem(scanned);
}

function highlightItem(upc) {
    const box = document.querySelector(`.product-box[data-upc="${upc}"]`);
    if(box) {
        box.scrollIntoView({behavior: "smooth", block: "center"});
        box.classList.add('highlight'); // Orange border
        
        // Auto-complete logic (Optional)
        if(!box.classList.contains('completed')) {
            toggleComplete(upc, box);
        }

        setTimeout(() => box.classList.remove('highlight'), 2000);
    }
}

function handleSearch(e) {
    const term = normalizeUPC(e.target.value.toLowerCase().trim());
    if(!term) {
        document.querySelectorAll('.product-box').forEach(b => b.style.opacity = "1");
        return;
    }

    // Search in current bay view
    document.querySelectorAll('.product-box').forEach(box => {
        const u = box.dataset.upc;
        const d = box.dataset.desc;
        if(u.includes(term) || d.includes(term)) {
            box.style.opacity = "1";
            box.style.border = "3px solid blue";
        } else {
            box.style.opacity = "0.1";
            box.style.border = "1px solid #999";
        }
    });
}

// --- PDF ---
function openPDF() {
    if(!currentPOG) return alert("Select a store first.");
    // Find PDF file containing POG ID
    const pdf = fileIndex.find(f => f.includes(currentPOG) && f.endsWith('.pdf'));
    
    if(pdf) {
        document.getElementById('pdf-frame').src = pdf;
        document.getElementById('pdf-modal').classList.remove('hidden');
    } else {
        alert("PDF not available for POG " + currentPOG);
    }
}

function closePDF() {
    document.getElementById('pdf-modal').classList.add('hidden');
    document.getElementById('pdf-frame').src = "";
}
