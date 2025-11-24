// CONFIGURATION
const REPO_BASE = window.location.href.substring(0, window.location.href.lastIndexOf('/')) + "/";
const SCALE = 20; // 20px = 1 inch on screen
const BOARD_W = 46; // holes
const BOARD_H = 64; // holes

// STATE
let fileIndex = []; // Content of githubfiles.csv
let pogData = []; // Content of allplanogramdata.csv
let storeMap = []; // Content of Store_POG_Mapping.csv
let currentStore = null;
let currentPOG = null;
let completedItems = new Set(JSON.parse(localStorage.getItem('harpa_complete') || "[]"));

// INIT
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadData();
        const savedStore = localStorage.getItem('harpa_store');
        if (savedStore) {
            selectStore(savedStore);
        } else {
            document.getElementById('loading-overlay').classList.add('hidden');
            document.getElementById('store-modal').classList.remove('hidden');
        }
    } catch (e) {
        alert("Error loading data: " + e.message);
    }
    
    // Bind Events
    document.getElementById('btn-load-store').onclick = () => {
        const store = document.getElementById('store-input').value;
        selectStore(store);
    };
});

// 1. DATA FETCHING
async function loadData() {
    const [filesText, pogText, mapText] = await Promise.all([
        fetch('githubfiles.csv').then(r => r.text()),
        fetch('allplanogramdata.csv').then(r => r.text()),
        fetch('Store_POG_Mapping.csv').then(r => r.text())
    ]);

    fileIndex = filesText.split('\n').map(line => line.trim()).filter(l => l);
    pogData = parseCSV(pogText);
    storeMap = parseCSV(mapText);
}

// CSV Parser (Handles basic CSV structure)
function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.trim());
    const result = [];
    
    for(let i=1; i<lines.length; i++) {
        // Handle commas inside quotes if strictly necessary, 
        // but simple split is usually fine for this specific dataset
        const row = lines[i].split(','); 
        if(row.length < headers.length) continue;
        
        let obj = {};
        headers.forEach((h, index) => {
            obj[h] = row[index] ? row[index].trim() : "";
        });
        result.push(obj);
    }
    return result;
}

// 2. STORE LOGIC
function selectStore(storeNum) {
    const mapping = storeMap.find(s => s.Store === storeNum);
    
    if(!mapping) {
        document.getElementById('error-msg').classList.remove('hidden');
        return;
    }

    currentStore = mapping;
    currentPOG = mapping.POG;
    
    localStorage.setItem('harpa_store', storeNum);
    
    // UI Update
    document.getElementById('store-modal').classList.add('hidden');
    document.getElementById('loading-overlay').classList.add('hidden');
    document.getElementById('store-display').innerText = `Store #${storeNum}`;
    document.getElementById('pog-display').innerText = `POG: ${currentPOG}`;
    
    renderBayButtons();
}

function changeStore() {
    localStorage.removeItem('harpa_store');
    location.reload();
}

// 3. RENDERING
function renderBayButtons() {
    // Filter items for this POG
    const items = pogData.filter(i => i.POG === currentPOG);
    // Get unique bays
    const bays = [...new Set(items.map(i => i.Bay))].sort((a,b) => a-b);
    
    const nav = document.getElementById('bay-nav');
    nav.innerHTML = '';
    
    bays.forEach((bay, index) => {
        const btn = document.createElement('button');
        btn.className = 'bay-btn';
        btn.innerText = `Bay ${bay}`;
        btn.onclick = () => loadBay(bay);
        nav.appendChild(btn);
        if(index === 0) loadBay(bay);
    });
}

function loadBay(bay) {
    // Update Active Button
    document.querySelectorAll('.bay-btn').forEach(b => {
        b.classList.toggle('active', b.innerText === `Bay ${bay}`);
    });

    const canvas = document.getElementById('pegboard-canvas');
    canvas.innerHTML = '';
    
    // Set Canvas Size (46 x 64 holes * Scale)
    canvas.style.width = `${BOARD_W * SCALE}px`;
    canvas.style.height = `${BOARD_H * SCALE}px`;
    
    const items = pogData.filter(i => i.POG === currentPOG && i.Bay === bay);
    const totalItems = items.length;
    let completedCount = 0;

    items.forEach(item => {
        // Parse Peg Location "Rxx Cxx"
        const match = item.Peg.match(/R(\d+)\s*C(\d+)/);
        if(!match) return;
        
        const rowHole = parseInt(match[1]);
        const colHole = parseInt(match[2]);
        
        // Parse Dimensions "10.90 in" -> 10.9
        const h = parseFloat(item.Height) || 6;
        const w = parseFloat(item.Width) || 3;
        
        // --- RENDERING LOGIC (The Frog) ---
        // The specific hole (R, C) is where the LEFT LEG of the frog goes.
        // We place a Red Dot there.
        const frogX = (colHole - 1) * SCALE + (SCALE/2);
        const frogY = (rowHole - 1) * SCALE + (SCALE/2);
        
        const frog = document.createElement('div');
        frog.className = 'frog-point';
        frog.style.left = `${frogX}px`;
        frog.style.top = `${frogY}px`;
        canvas.appendChild(frog);

        // Product Box
        // Products hang centered on the frog, extending downwards.
        // Box Top = Frog Y. 
        // Box Center X = Frog X.
        const box = document.createElement('div');
        box.className = 'product-item';
        if(completedItems.has(item.UPC)) {
            box.classList.add('completed');
            completedCount++;
        }
        
        box.style.width = `${w * SCALE}px`;
        box.style.height = `${h * SCALE}px`;
        // Left = FrogX - (Width/2)
        box.style.left = `${frogX - (w * SCALE / 2)}px`;
        box.style.top = `${frogY}px`; // Hanging down from peg
        
        // Find Image
        const imgFile = fileIndex.find(f => f.startsWith(item.UPC));
        if(imgFile) {
            const img = document.createElement('img');
            img.src = imgFile; // Relative path works on GH Pages
            img.loading = "lazy";
            box.appendChild(img);
        } else {
            box.innerText = item.UPC;
            box.style.fontSize = '10px';
            box.style.textAlign = 'center';
        }

        // Interaction
        box.onclick = () => {
            toggleComplete(item.UPC, box);
        };

        canvas.appendChild(box);
    });

    updateProgress(completedCount, totalItems);
}

// 4. UTILITIES
function toggleComplete(upc, element) {
    if(completedItems.has(upc)) {
        completedItems.delete(upc);
        element.classList.remove('completed');
    } else {
        completedItems.add(upc);
        element.classList.add('completed');
    }
    localStorage.setItem('harpa_complete', JSON.stringify([...completedItems]));
    
    // Recalc progress for current bay
    const currentBayBtn = document.querySelector('.bay-btn.active');
    if(currentBayBtn) currentBayBtn.click(); // Re-render simply
}

function updateProgress(done, total) {
    const pct = Math.round((done / total) * 100);
    document.getElementById('progress-fill').style.width = `${pct}%`;
    document.getElementById('progress-count').innerText = `${done}/${total} Items`;
}

// 5. PDF VIEWER
function openPDF() {
    if(!currentPOG) return;
    // Find PDF containing the POG ID
    const pdfFile = fileIndex.find(f => f.includes(currentPOG) && f.endsWith('.pdf'));
    
    if(pdfFile) {
        const viewer = document.getElementById('pdf-modal');
        const frame = document.getElementById('pdf-frame');
        frame.src = pdfFile; // Browser built-in PDF viewer
        viewer.classList.remove('hidden');
    } else {
        alert("PDF not found for POG: " + currentPOG);
    }
}

function closePDF() {
    document.getElementById('pdf-modal').classList.add('hidden');
    document.getElementById('pdf-frame').src = "";
}
