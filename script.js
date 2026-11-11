// Dynamic API URL - works both locally and on GitHub Pages
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:3000/api' 
    : `${window.location.protocol}//${window.location.host}/api`;

let products = [];
let billItems = [];
let useBackend = true; // switch to false if server not reachable
const LOCAL_STORAGE_KEY = 'storeProducts';

// Local fallback seed
const defaultProducts = [
    {
        id: 1,
        name: "Radiant Glow Face Powder",
        code: "FP-001",
        price: 7000.0,
        stock: 50,
        image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23ffeaa7' width='100' height='100'/%3E%3Ctext x='50%25' y='50%25' font-size='40' text-anchor='middle' dy='.3em'%3E✨%3C/text%3E%3C/svg%3E"
    },
    {
        id: 2,
        name: "Matte Velvet Lipstick",
        code: "LS-002",
        price: 5200.0,
        stock: 120,
        image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23ff7675' width='100' height='100'/%3E%3Ctext x='50%25' y='50%25' font-size='40' text-anchor='middle' dy='.3em'%3E💄%3C/text%3E%3C/svg%3E"
    },
    {
        id: 3,
        name: "Precision Point Eyeliner",
        code: "EL-003",
        price: 4200.0,
        stock: 0,
        image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23a29bfe' width='100' height='100'/%3E%3Ctext x='50%25' y='50%25' font-size='40' text-anchor='middle' dy='.3em'%3E✏️%3C/text%3E%3C/svg%3E"
    }
];

function persistLocalProducts() {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(products));
}

// Initialize the app when page loads
window.addEventListener('DOMContentLoaded', async function() {
    await fetchProducts();
    setupEventListeners();
});

// Fetch products from backend, fallback to local
async function fetchProducts() {
    try {
        const response = await fetch(`${API_URL}/products`);
        if (!response.ok) throw new Error('Bad response');
        const result = await response.json();
        products = result.data || [];
        useBackend = true;
    } catch (error) {
        console.error('Backend not reachable. SQL Server-backed API is required.', error);
        useBackend = false;
        products = [];
        alert('Cannot connect to the store server. Please start the Node.js server and check the SQL Server connection.');
    }
    persistLocalProducts();
    renderProducts();
}

// Render products into the table
function renderProducts() {
    const productList = document.getElementById('productList');
    productList.innerHTML = '';

    products.forEach(function(product) {
        const row = document.createElement('tr');

        let iconClass = '';
        if (product.name.includes('Lipstick')) {
            iconClass = 'lipstick';
        } else if (product.name.includes('Eyeliner')) {
            iconClass = 'eyeliner';
        }

        row.innerHTML = `
            <td>
                <div class="product-item">
                    <div class="product-icon ${iconClass}">
                        <img src="${product.image || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'%3E%3Crect fill=\'%23dfe6e9\' width=\'100\' height=\'100\'/%3E%3Ctext x=\'50%25\' y=\'50%25\' font-size=\'40\' text-anchor=\'middle\' dy=\'.3em\'%3E📦%3C/text%3E%3C/svg%3E'}" alt="${product.name}">
                    </div>
                    <span class="product-name">${product.name}</span>
                </div>
            </td>
            <td class="product-code">${product.code}</td>
            <td class="product-price">₫${Number(product.price).toLocaleString('vi-VN')}</td>
            <td class="product-stock">${product.stock}</td>
            <td>
                <input type="number" 
                       class="quantity-input" 
                       id="qty-${product.id}" 
                       min="1" 
                       max="${product.stock}" 
                       value="1"
                       ${product.stock === 0 ? 'disabled' : ''}>
            </td>
            <td>
                ${product.stock > 0 
                    ? `<button class="btn-add" onclick="addToBill(${product.id})">Add to Bill</button>`
                    : `<button class="btn-out-of-stock">Out of Stock</button>`
                }
            </td>
        `;

        productList.appendChild(row);
    });
}

// Stock is deducted by the backend only when a bill is committed (transaction + FEFO).
async function updateProductStock() { return; }

// Add product to bill
async function addToBill(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const qtyInput = document.getElementById('qty-' + productId);
    const quantity = parseInt(qtyInput.value);

    if (quantity <= 0 || quantity > product.stock) {
        alert('Invalid quantity! Please enter a valid number.');
        return;
    }

    const existingItem = billItems.find(item => item.id === productId);

    if (existingItem) {
        const newQuantity = existingItem.quantity + quantity;
        if (newQuantity > product.stock) {
            alert('Not enough stock! Available: ' + product.stock);
            return;
        }
        existingItem.quantity = newQuantity;
    } else {
        billItems.push({
            id: product.id,
            name: product.name,
            price: product.price,
            quantity: quantity
        });
    }

    qtyInput.value = 1;
    renderProducts();
    updateBillDisplay();
}

// Update the bill summary display
function updateBillDisplay() {
    const billItemsContainer = document.getElementById('billItems');
    
    // Clear current display
    billItemsContainer.innerHTML = '';

    // Check if bill is empty
    if (billItems.length === 0) {
        billItemsContainer.innerHTML = '<p class="empty-message">No items added yet</p>';
        updateTotals();
        return;
    }

    // Display each bill item
    billItems.forEach(function(item) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'bill-item';
        
        const itemTotal = item.price * item.quantity;
        
        itemDiv.innerHTML = `
            <div class="bill-item-details">
                <h4>${item.name}</h4>
                <p class="bill-item-qty">Qty: ${item.quantity}</p>
            </div>
            <div class="bill-item-right">
                <span class="bill-item-price">₫${Number(itemTotal).toLocaleString('vi-VN')}</span>
                <button class="btn-remove" onclick="removeFromBill(${item.id})">🗑️</button>
            </div>
        `;
        
        billItemsContainer.appendChild(itemDiv);
    });

    // Update totals
    updateTotals();
}

// Remove item from bill
async function removeFromBill(productId) {
    const billItemIndex = billItems.findIndex(item => item.id === productId);
    if (billItemIndex === -1) return;

    const billItem = billItems[billItemIndex];

    billItems.splice(billItemIndex, 1);
    renderProducts();
    updateBillDisplay();
}

// Calculate and update totals
function updateTotals() {
    // Calculate subtotal
    let subtotal = 0;
    billItems.forEach(function(item) {
        subtotal += item.price * item.quantity;
    });

    // Calculate tax (10%)
    const tax = subtotal * 0.10;

    // Calculate total
    const total = subtotal + tax;

    // Update display
    document.getElementById('subtotal').textContent = subtotal.toLocaleString('vi-VN') + ' ₫';
    document.getElementById('tax').textContent = tax.toLocaleString('vi-VN') + ' ₫';
    document.getElementById('totalAmount').textContent = total.toLocaleString('vi-VN') + ' ₫';
}

// Reset the bill
async function resetBill() {
    if (billItems.length > 0 && !confirm('Are you sure you want to reset the bill?')) {
        return;
    }

    billItems = [];
    renderProducts();
    updateBillDisplay();
}

// Commit the bill to SQL Server. Backend validates stock and consumes the earliest-expiring batches (FEFO).
async function printBill() {
    if (billItems.length === 0) { alert('No items in the bill to print!'); return; }
    try {
        const response = await fetch(`${API_URL}/bills`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: billItems.map(item => ({ id: item.id, quantity: item.quantity })) })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            if (response.status === 401) { alert('Please sign in before checking out.'); window.location.href = 'login.html'; return; }
            throw new Error(result.message || 'Could not save bill');
        }
        alert(`Đã tạo hóa đơn #${result.data.id}. Tổng tiền: ${Number(result.data.total).toLocaleString('vi-VN')} VNĐ`);
        const shouldPay = confirm('Bạn có muốn thanh toán hóa đơn này qua MoMo ngay bây giờ không?');
        if (shouldPay) {
            const paymentResponse = await fetch(`${API_URL}/payments/momo/create`, {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({billId:result.data.id})});
            const payment = await paymentResponse.json();
            if (!paymentResponse.ok || !payment.success) throw new Error(payment.message || 'Không thể tạo thanh toán MoMo.');
            window.location.href = payment.data.payUrl;
            return;
        }
        billItems = [];
        await fetchProducts();
        updateBillDisplay();
        window.print();
    } catch (error) {
        alert(error.message || 'Could not save bill. Please check your connection.');
    }
}

// Search functionality
function searchProducts() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const rows = document.querySelectorAll('.product-table tbody tr');

    rows.forEach(function(row) {
        const productName = row.querySelector('.product-name').textContent.toLowerCase();
        const productCode = row.querySelector('.product-code').textContent.toLowerCase();

        if (productName.includes(searchTerm) || productCode.includes(searchTerm)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('resetBtn').addEventListener('click', resetBill);
    document.getElementById('printBtn').addEventListener('click', printBill);
    document.getElementById('searchInput').addEventListener('input', searchProducts);
}
