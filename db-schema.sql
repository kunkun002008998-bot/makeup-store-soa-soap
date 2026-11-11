/*
  Makeup Store SOA/SOAP - Microsoft SQL Server schema
  Run this script in SQL Server Management Studio (SSMS).
  It creates the makeup_store database and all application tables.
*/
IF DB_ID(N'makeup_store') IS NULL
BEGIN
    CREATE DATABASE [makeup_store];
END;
GO

USE [makeup_store];
GO

IF OBJECT_ID(N'dbo.categories', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.categories (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_categories PRIMARY KEY,
        name NVARCHAR(150) NOT NULL CONSTRAINT UQ_categories_name UNIQUE,
        description NVARCHAR(MAX) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_categories_created_at DEFAULT SYSDATETIME()
    );
END;
GO

IF OBJECT_ID(N'dbo.brands', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.brands (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_brands PRIMARY KEY,
        name NVARCHAR(150) NOT NULL CONSTRAINT UQ_brands_name UNIQUE,
        description NVARCHAR(MAX) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_brands_created_at DEFAULT SYSDATETIME()
    );
END;
GO

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.users (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_users PRIMARY KEY,
        name NVARCHAR(120) NOT NULL,
        email NVARCHAR(190) NOT NULL CONSTRAINT UQ_users_email UNIQUE,
        password_hash NVARCHAR(255) NOT NULL,
        role NVARCHAR(20) NOT NULL CONSTRAINT DF_users_role DEFAULT N'cashier',
        active BIT NOT NULL CONSTRAINT DF_users_active DEFAULT 1,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_users_created_at DEFAULT SYSDATETIME(),
        CONSTRAINT CK_users_role CHECK (role IN (N'admin',N'cashier'))
    );
END;
GO

IF OBJECT_ID(N'dbo.products', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.products (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_products PRIMARY KEY,
        name NVARCHAR(190) NOT NULL,
        code NVARCHAR(80) NOT NULL CONSTRAINT UQ_products_code UNIQUE,
        price DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_price DEFAULT 0,
        image NVARCHAR(MAX) NULL,
        category_id BIGINT NULL,
        brand_id BIGINT NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_products_created_at DEFAULT SYSDATETIME(),
        updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_products_updated_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_products_category FOREIGN KEY (category_id) REFERENCES dbo.categories(id) ON DELETE SET NULL,
        CONSTRAINT FK_products_brand FOREIGN KEY (brand_id) REFERENCES dbo.brands(id) ON DELETE SET NULL
    );
END;
GO

IF OBJECT_ID(N'dbo.suppliers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.suppliers (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_suppliers PRIMARY KEY,
        name NVARCHAR(190) NOT NULL,
        phone NVARCHAR(40) NULL,
        email NVARCHAR(190) NULL,
        address NVARCHAR(MAX) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_suppliers_created_at DEFAULT SYSDATETIME()
    );
END;
GO

IF OBJECT_ID(N'dbo.customers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.customers (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_customers PRIMARY KEY,
        name NVARCHAR(190) NOT NULL,
        phone NVARCHAR(40) NULL,
        email NVARCHAR(190) NULL,
        address NVARCHAR(MAX) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_customers_created_at DEFAULT SYSDATETIME()
    );
END;
GO

IF OBJECT_ID(N'dbo.inventory_batches', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.inventory_batches (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_inventory_batches PRIMARY KEY,
        product_id BIGINT NOT NULL,
        batch_code NVARCHAR(100) NOT NULL,
        quantity INT NOT NULL CONSTRAINT DF_inventory_batches_quantity DEFAULT 0,
        manufacture_date DATE NULL,
        expiry_date DATE NOT NULL,
        supplier NVARCHAR(190) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_inventory_batches_created_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_batch_product FOREIGN KEY (product_id) REFERENCES dbo.products(id) ON DELETE CASCADE,
        CONSTRAINT UQ_product_batch UNIQUE (product_id, batch_code),
        CONSTRAINT CK_inventory_batches_quantity CHECK (quantity >= 0)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_inventory_batches_expiry' AND object_id=OBJECT_ID(N'dbo.inventory_batches'))
    CREATE INDEX IX_inventory_batches_expiry ON dbo.inventory_batches(expiry_date, quantity);
GO

IF OBJECT_ID(N'dbo.bills', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.bills (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_bills PRIMARY KEY,
        subtotal DECIMAL(12,2) NOT NULL,
        tax DECIMAL(12,2) NOT NULL,
        total DECIMAL(12,2) NOT NULL,
        created_by BIGINT NULL,
        payment_status NVARCHAR(20) NOT NULL CONSTRAINT DF_bills_payment_status DEFAULT N'unpaid',
        payment_method NVARCHAR(40) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_bills_created_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_bill_user FOREIGN KEY (created_by) REFERENCES dbo.users(id) ON DELETE SET NULL,
        CONSTRAINT CK_bills_payment_status CHECK (payment_status IN (N'unpaid',N'pending',N'paid',N'failed'))
    );
END;
GO

IF OBJECT_ID(N'dbo.bill_items', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.bill_items (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_bill_items PRIMARY KEY,
        bill_id BIGINT NOT NULL,
        product_id BIGINT NULL,
        product_name NVARCHAR(190) NOT NULL,
        product_code NVARCHAR(80) NOT NULL,
        unit_price DECIMAL(12,2) NOT NULL,
        quantity INT NOT NULL,
        line_total DECIMAL(12,2) NOT NULL,
        CONSTRAINT FK_item_bill FOREIGN KEY (bill_id) REFERENCES dbo.bills(id) ON DELETE CASCADE,
        CONSTRAINT FK_item_product FOREIGN KEY (product_id) REFERENCES dbo.products(id) ON DELETE SET NULL,
        CONSTRAINT CK_bill_items_quantity CHECK (quantity > 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.alert_logs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.alert_logs (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_alert_logs PRIMARY KEY,
        batch_id BIGINT NOT NULL,
        alert_type NVARCHAR(20) NOT NULL,
        sent_to NVARCHAR(190) NULL,
        status NVARCHAR(20) NOT NULL CONSTRAINT DF_alert_logs_status DEFAULT N'in_app',
        message NVARCHAR(MAX) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_alert_logs_created_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_alert_batch FOREIGN KEY (batch_id) REFERENCES dbo.inventory_batches(id) ON DELETE CASCADE,
        CONSTRAINT CK_alert_logs_type CHECK (alert_type IN (N'expiring',N'expired',N'low_stock')),
        CONSTRAINT CK_alert_logs_status CHECK (status IN (N'sent',N'failed',N'in_app'))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_alert_logs_batch_type_date' AND object_id=OBJECT_ID(N'dbo.alert_logs'))
    CREATE INDEX IX_alert_logs_batch_type_date ON dbo.alert_logs(batch_id, alert_type, created_at);
GO

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.payment_transactions (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_payment_transactions PRIMARY KEY,
        bill_id BIGINT NOT NULL,
        provider NVARCHAR(30) NOT NULL,
        provider_order_id NVARCHAR(120) NOT NULL CONSTRAINT UQ_payment_provider_order_id UNIQUE,
        request_id NVARCHAR(120) NOT NULL CONSTRAINT UQ_payment_request_id UNIQUE,
        provider_transaction_id NVARCHAR(120) NULL,
        amount DECIMAL(12,0) NOT NULL,
        status NVARCHAR(20) NOT NULL CONSTRAINT DF_payment_transactions_status DEFAULT N'pending',
        pay_url NVARCHAR(MAX) NULL,
        request_payload NVARCHAR(MAX) NULL,
        response_payload NVARCHAR(MAX) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_payment_transactions_created_at DEFAULT SYSDATETIME(),
        paid_at DATETIME2(0) NULL,
        CONSTRAINT FK_payment_bill FOREIGN KEY (bill_id) REFERENCES dbo.bills(id) ON DELETE CASCADE,
        CONSTRAINT CK_payment_transactions_status CHECK (status IN (N'pending',N'paid',N'failed',N'expired'))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_payment_transactions_status' AND object_id=OBJECT_ID(N'dbo.payment_transactions'))
    CREATE INDEX IX_payment_transactions_status ON dbo.payment_transactions(status);
GO

PRINT N'Makeup Store database schema is ready.';
GO
