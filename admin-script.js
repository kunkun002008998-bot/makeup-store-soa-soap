// Admin Panel JavaScript - Product Management (with backend persistence)

// Dynamic API URL - works both locally and on GitHub Pages
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:3000/api' 
    : `${window.location.protocol}//${window.location.host}/api`;

let products = [];
let editingProductId = null;
let deleteProductId = null;
let selectedImageData = null;
let useBackend = true;
const LOCAL_STORAGE_KEY = 'storeProducts';

// Default products fallback
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

// Initialize when page loads
window.addEventListener('DOMContentLoaded', async () => {
    try { const auth = await fetch(`${API_URL}/auth/me`, { credentials: 'include' }); if (!auth.ok) { window.location.href = 'login.html?next=admin.html'; return; } const authData = await auth.json(); if (authData.data?.role !== 'admin') { alert('Trang này chỉ dành cho quản trị viên.'); window.location.href = 'index.html'; return; } } catch (_) { window.location.href = 'login.html?next=admin.html'; return; }
    await loadCategoriesAndBrands();
    loadProducts();
    setupEventListeners();
});

// Setup all event listeners
function setupEventListeners() {
    document.getElementById('productForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('cancelBtn').addEventListener('click', resetForm);
    document.getElementById('cancelDelete').addEventListener('click', closeDeleteModal);
    document.getElementById('confirmDelete').addEventListener('click', confirmDeleteProduct);
    document.getElementById('productImage').addEventListener('change', handleImageUpload);
}

// Load products from backend with local fallback
async function loadCategoriesAndBrands(){
    try {
        const [cats,brands]=await Promise.all([fetch(`${API_URL}/categories`,{credentials:'include'}).then(r=>r.json()),fetch(`${API_URL}/brands`,{credentials:'include'}).then(r=>r.json())]);
        const fill=(id,data)=>{const el=document.getElementById(id);el.innerHTML='<option value="">-- Không chọn --</option>'+(data.data||[]).map(x=>`<option value="${x.id}">${String(x.name).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</option>`).join('');};
        fill('productCategory',cats);fill('productBrand',brands);
    } catch(e){console.warn('Could not load category/brand options',e);}
}

async function loadProducts() {
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
        showMessage('Cannot connect to the backend / SQL Server database.', 'error');
    }
    persistLocalProducts();
    displayProducts();
}

// Display all products
function displayProducts() {
    const productList = document.getElementById('productList');
    const productCount = document.getElementById('productCount');

    productCount.textContent = `${products.length} product${products.length !== 1 ? 's' : ''}`;
    productList.innerHTML = '';

    if (products.length === 0) {
        productList.innerHTML = '<p class="empty-message">No products yet. Add your first product!</p>';
        return;
    }

    products.forEach((product) => {
        const card = document.createElement('div');
        card.className = 'product-card';

        let stockClass = 'stock-available';
        let stockText = `In Stock (${product.stock})`;
        if (product.stock === 0) {
            stockClass = 'stock-out';
            stockText = 'Out of Stock';
        } else if (product.stock < 20) {
            stockClass = 'stock-low';
            stockText = `Low Stock (${product.stock})`;
        }

        card.innerHTML = `
            <div class="product-icon-large">
                <img src="${product.image || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'%3E%3Crect fill=\'%23dfe6e9\' width=\'100\' height=\'100\'/%3E%3Ctext x=\'50%25\' y=\'50%25\' font-size=\'40\' text-anchor=\'middle\' dy=\'.3em\'%3E📦%3C/text%3E%3C/svg%3E'}" alt="${product.name}">
            </div>
            <div class="product-details">
                <h3>${product.name}</h3>
                <div class="product-meta">
                    <span>📋 ${product.code}</span>
                    <span class="product-stock ${stockClass}">${stockText}</span>
                </div>
                <div class="product-price-large">₫${Number(product.price).toLocaleString('vi-VN')}</div>
            </div>
            <div class="product-actions">
                <button class="btn-edit" data-id="${product.id}">✏️ Edit</button>
                <button class="btn-delete-small" data-id="${product.id}">🗑️ Delete</button>
            </div>
        `;

        card.querySelector('.btn-edit').addEventListener('click', () => editProduct(product.id));
        card.querySelector('.btn-delete-small').addEventListener('click', () => openDeleteModal(product.id));

        productList.appendChild(card);
    });
}

// Handle form submission (Add or Edit)
async function handleFormSubmit(event) {
    event.preventDefault();

    const name = document.getElementById('productName').value.trim();
    const code = document.getElementById('productCode').value.trim();
    const price = parseFloat(document.getElementById('productPrice').value);
    const stock = parseInt(document.getElementById('productStock').value);
    const image = selectedImageData || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'%3E%3Crect fill=\'%23dfe6e9\' width=\'100\' height=\'100\'/%3E%3Ctext x=\'50%25\' y=\'50%25\' font-size=\'40\' text-anchor=\'middle\' dy=\'.3em\'%3E📦%3C/text%3E%3C/svg%3E';

    if (!name || !code || price < 0 || stock < 0) {
        showMessage('Please fill all required fields correctly!', 'error');
        return;
    }

    try {
        const payload = { name, code, price, stock, image, categoryId:document.getElementById('productCategory').value || null, brandId:document.getElementById('productBrand').value || null };

        if (!useBackend) throw new Error('Backend / SQL Server is not available. No local-only changes were saved.');
        if (editingProductId) {
            const response = await fetch(`${API_URL}/products/${editingProductId}`, { credentials: 'include',
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Could not update product');
            showMessage('Product updated successfully!', 'success');
            editingProductId = null;
        } else {
            const response = await fetch(`${API_URL}/products`, { credentials: 'include',
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Could not add product');
            showMessage('Product added successfully!', 'success');
        }

        resetForm();
        await loadProducts();
    } catch (error) {
        console.error('Save failed', error);
        showMessage(error.message || 'Could not save product.', 'error');
    }
}

// Edit product
function editProduct(productId) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    editingProductId = productId;

    document.getElementById('productName').value = product.name;
    document.getElementById('productCode').value = product.code;
    document.getElementById('productPrice').value = product.price;
    document.getElementById('productStock').value = product.stock;
    document.getElementById('productCategory').value = product.category_id || '';
    document.getElementById('productBrand').value = product.brand_id || '';

    if (product.image) {
        selectedImageData = product.image;
        const previewImg = document.getElementById('previewImg');
        previewImg.src = product.image;
        previewImg.style.display = 'block';
    }

    document.getElementById('formTitle').textContent = 'Edit Product';
    document.getElementById('submitBtn').textContent = 'Update Product';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Open delete confirmation modal
function openDeleteModal(productId) {
    deleteProductId = productId;
    const product = products.find((p) => p.id === productId);
    if (product) {
        document.getElementById('deleteProductName').textContent = product.name;
        document.getElementById('deleteModal').classList.add('active');
    }
}

// Close delete modal
function closeDeleteModal() {
    deleteProductId = null;
    document.getElementById('deleteModal').classList.remove('active');
}

// Confirm and delete product
async function confirmDeleteProduct() {
    if (!deleteProductId) return;

    try {
        if (!useBackend) throw new Error('Backend / SQL Server is not available.');
        const response = await fetch(`${API_URL}/products/${deleteProductId}`, { method: 'DELETE', credentials: 'include' });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'Could not delete product');
        showMessage('Product deleted successfully!', 'success');
        closeDeleteModal();
        await loadProducts();
    } catch (error) {
        console.error('Delete failed', error);
        showMessage(error.message || 'Could not delete product.', 'error');
    }
}

// Handle image upload and preview
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            selectedImageData = e.target.result;
            const previewImg = document.getElementById('previewImg');
            previewImg.src = selectedImageData;
            previewImg.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

// Reset form to add mode
function resetForm() {
    document.getElementById('productForm').reset();
    editingProductId = null;
    deleteProductId = null;
    selectedImageData = null;
    document.getElementById('formTitle').textContent = 'Add New Product';
    document.getElementById('submitBtn').textContent = 'Add Product';

    const previewImg = document.getElementById('previewImg');
    previewImg.src = '';
    previewImg.style.display = 'none';
}

// Show success or error message
function showMessage(message, type) {
    const existingMessage = document.querySelector('.message');
    if (existingMessage) existingMessage.remove();

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;

    const formSection = document.querySelector('.form-section');
    formSection.insertBefore(messageDiv, formSection.firstChild);

    setTimeout(() => messageDiv.remove(), 3000);
}

// Close modal when clicking outside
window.addEventListener('click', function(event) {
    const modal = document.getElementById('deleteModal');
    if (event.target === modal) {
        closeDeleteModal();
    }
});
