// ==========================================
// CONFIGURATION & CONSTANTS
// ==========================================
const REPO_BASE = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + "/";
const IMG_PATH = "images/"; 

// PEGBOARD PHYSICAL DIMENSIONS (HOLES)
const BOARD_WIDTH_HOLES = 46; // Total width in holes (approx 46 inches usable)
const BOARD_HEIGHT_HOLES = 64; // Total height in holes

// DISPLAY SCALE
// PPI = Pixels Per Inch (Per Hole). 
// 18px provides good resolution on mobile while keeping the board manageable.
const PPI = 18; 

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
        alert("Data Load Error: " + error.message);
    }

    // Event Bindings
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
// DATA HANDLING
// ==========================================
async function loadCSVData() {
    const ts = new Date().getTime(); // Cache busting
    const [filesReq, pogReq, mapReq] = await Promise.all([
        fetch(`githubfiles.csv?t=${ts}`),
        fetch(`allplanogramdata.csv?t=${ts}`),
        fetch(`Store_POG_Mapping.csv?t=${ts}`)
    ]);

    if (!filesReq.ok || !pogReq.ok || !mapReq.ok) throw new Error("Failed to fetch CSV data.");

    const filesText = await filesReq.text();
    const pogText = await pogReq.text();
    const mapText = await mapReq.text();

    fileIndex = filesText.split('\n').map(l => l.trim());
    
    storeMap = parseCSV(mapText);
    
    // Pre-process POG data with clean UPCs
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
        // Simple comma split. 
        // NOTE: If your descriptions contain commas, this simple parser will break. 
        // For MVP with the provided data, this is sufficient.
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
    // Convert to string and strip ALL leading zeros
    return upc.toString().trim().replace(/^0+/, '');
}

// ==========================================
// STORE & NAVIGATION LOGIC
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

    // Identify available bays for this POG
    const items = pogData.filter(i => i.POG === currentPOG);
    allBays = [...new Set(items.map(i => parseInt(i.Bay)))].sort((a,b) => a-b);
    
    if (allBays.length === 0) return alert("No items found for POG " + currentPOG);

    // Update UI
    document.getElementById('store-modal').classList.add('hidden');
    document.getElementById('store-display').innerText = `Store #${storeNum}`;
    document.getElementById('pog-display').innerText = `POG: ${currentPOG}`;
    document.getElementById('error-msg').classList.add('hidden');

    // Load First Bay
    loadBay(allBays[0]);
}

function resetStore() {
    localStorage.removeItem('harpa_store');
    location.reload();
}

function changeBay(dir) {
    const currentIndex = allBays.indexOf(currentBay);
    if (currentIndex === -1) return;
    let newIndex = currentIndex + dir;
    
    // Bounds check
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= allBays.length) newIndex = allBays.length - 1;
    
    if (allBays[newIndex] !== currentBay) {
        loadBay(allBays[newIndex]);
    }
}

function loadBay(bayNum) {
    currentBay = bayNum;
    document.getElementById('bay-indicator').innerText = `Bay ${bayNum} of ${allBays.length}`;
    
    // Update Arrows
    document.getElementById('prev-bay').disabled = (bayNum === allBays[0]);
    document.getElementById('next-bay').disabled = (bayNum === allBays[allBays.length - 1]);
    document.getElementById('prev-bay').style.opacity = (bayNum === allBays[0]) ? 0.3 : 1;
    document.getElementById('next-bay').style.opacity = (bayNum === allBays[allBays.length - 1]) ? 0.3 : 1;

    renderGrid(bayNum);
}

// ==========================================
// GRID RENDERING (PEGBOARD VISUAL)
// ==========================================
function renderGrid(bayNum) {
    const container = document.getElementById('pegboard-container');
    container.innerHTML = '';

    // 1. Draw the Board (46 x 64 holes)
    const pxWidth = BOARD_WIDTH_HOLES * PPI;
    const pxHeight = BOARD_HEIGHT_HOLES * PPI;

    container.style.width = `${pxWidth}px`;
    container.style.height = `${pxHeight}px`;
    
    // Draw grid points using CSS gradient (Visual only)
    // Dot color defined in CSS.
    container.style.backgroundSize = `${PPI}px ${PPI}px`;
    container.style.backgroundImage = `radial-gradient(circle, #1a1a1a 20%, transparent 21%)`;

    // 2. Get Items for Bay
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
    let completeCount = 0;

    items.forEach(item => {
        const cleanUPC = item.CleanUPC;
        const { r, c } = getPegCoordinates(item.Peg);
        
        // Dimensions (Inches to Pixels)
        const hVal = parseFloat(item.Height.replace(' in', '')) || 6;
        const wVal = parseFloat(item.Width.replace(' in', '')) || 3;
        
        const itemH = hVal * PPI;
        const itemW = wVal * PPI;

        // --- FROG LOGIC ---
        // The "Peg" data (e.g. R02 C03) refers to the LEFT hole of the frog.
        // (1,1) is top-left hole.
        // X position of Hole C = (C - 1) * PPI
        // Y position of Hole R = (R - 1) * PPI
        
        const frogHoleX = (c - 1) * PPI;
        const frogHoleY = (r - 1) * PPI;

        // Place RED DOT on the specific hole
        const frog = document.createElement('div');
        frog.className = 'frog-dot';
        // Add half PPI to center it within the "cell"
        frog.style.left = `${frogHoleX + (PPI/2)}px`;
        frog.style.top = `${frogHoleY + (PPI/2)}px`;
        container.appendChild(frog);

        // --- PRODUCT ALIGNMENT ---
        // The frog spans 2 holes (C and C+1). 
        // The center of the product aligns with the midpoint of those two holes.
        // Midpoint X = frogHoleX + (PPI / 2)
        
        const centerX = frogHoleX + (PPI / 2);
        const boxLeft = centerX - (itemW / 2);
        // Product hangs down from the peg row
        const boxTop = frogHoleY + (PPI / 2);

        // Create Product Box
        const box = document.createElement('div');
        box.className = 'product-box';
        box.style.width = `${itemW}px`;
        box.style.height = `${itemH}px`;
        box.style.left = `${boxLeft}px`;
        box.style.top = `${boxTop}px`;
        box.dataset.upc = cleanUPC;

        // Check Status
        if (completedItems.has(cleanUPC)) {
            box.classList.add('completed');
            completeCount++;
        }

        // Image
        // Find image that starts with raw UPC from CSV
        const imgFile = fileIndex.find(f => f.startsWith(item.UPC));
        if (imgFile) {
            const img = document.createElement('img');
            img.src = imgFile; // Relative path
            img.loading = "lazy";
            box.appendChild(img);
        } else {
            // Fallback
            box.innerText = item.UPC;
            box.style.fontSize = "9px";
            box.style.textAlign = "center";
            box.style.overflow = "hidden";
        }

        // Interaction
        box.onclick = () => toggleComplete(cleanUPC, box);
        container.appendChild(box);
    });

    updateProgress(completeCount, items.length);
}

// Helper: Parse "R02 C03"
function getPegCoordinates(pegStr) {
    if(!pegStr) return {r:1, c:1};
    const m = pegStr.match(/R(\d+)\s*C(\d+)/);
    if(m) return { r: parseInt(m[1]), c: parseInt(m[2]) };
    return { r: 1, c: 1 }; // Default
}

// ==========================================
// STATE & PROGRESS
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
    
    // Update bar
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
    const done = items.filter(i => completedItems.has(i.CleanUPC)).length;
    updateProgress(done, items.length);
}

function updateProgress(done, total) {
    const pct = total > 0 ? Math.round((done/total)*100) : 0;
    document.getElementById('progress-fill').style.width = `${pct}%`;
    document.getElementById('progress-count').innerText = `${done}/${total}`;
}

function loadProgress() {
    const s = localStorage.getItem('harpa_complete');
    if(s) completedItems = new Set(JSON.parse(s));
}

// ==========================================
// SCANNER & SEARCH LOGIC
// ==========================================
function startScanner() {
    document.getElementById('scanner-modal').classList.remove('hidden');
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" }, 
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            // Don't close automatically, just process
            handleSearchOrScan(decodedText);
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

function handleSearchOrScan(inputVal) {
    if(!inputVal) return;
    
    // Show debug info
    const cleanInput = normalizeUPC(inputVal);
    document.getElementById('scan-debug').innerHTML = `Scanned: <b>${inputVal}</b> | Clean: <b>${cleanInput}</b>`;

    // 1. Search Global POG (All Bays)
    const match = pogData.find(i => i.POG === currentPOG && i.CleanUPC === cleanInput);
    
    if(!match) {
        // Not found
        document.getElementById('scan-debug').style.color = 'red';
        document.getElementById('scan-debug').innerHTML += " - NOT FOUND";
        return;
    }

    document.getElementById('scan-debug').style.color = 'green';
    document.getElementById('scan-debug').innerHTML += " - OK";

    // 2. Check Bay
    const matchBay = parseInt(match.Bay);
    
    if(matchBay !== currentBay) {
        // Auto Switch
        loadBay(matchBay);
        // Wait for DOM
        setTimeout(() => highlightItem(cleanInput), 500);
    } else {
        highlightItem(cleanInput);
    }
}

function highlightItem(upc) {
    const box = document.querySelector(`.product-box[data-upc="${upc}"]`);
    if(box) {
        box.scrollIntoView({behavior: "smooth", block: "center"});
        box.classList.add('highlight');
        
        // Auto-complete logic
        if(!box.classList.contains('completed')) {
            toggleComplete(upc, box);
        }
        
        setTimeout(() => box.classList.remove('highlight'), 1500);
    }
}

// ==========================================
// PDF & SWIPE
// ==========================================
function openPDF() {
    if(!currentPOG) return alert("Load store first");
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
    const area = document.getElementById('main-scroll-area');
    area.addEventListener('touchstart', e => startX = e.changedTouches[0].screenX, {passive:true});
    area.addEventListener('touchend', e => {
        const diff = e.changedTouches[0].screenX - startX;
        if(Math.abs(diff) > 60) {
            if(diff > 0) changeBay(-1); // Swipe Right -> Prev
            else changeBay(1); // Swipe Left -> Next
        }
    }, {passive:true});
}
