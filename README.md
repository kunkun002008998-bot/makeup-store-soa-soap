# Makeup Store — Quản lý cửa hàng mỹ phẩm theo kiến trúc SOA (SQL Server + SOAP + REST)

Dự án Node.js + Express được tổ chức theo các dịch vụ nghiệp vụ (SOA), cung cấp REST API cho giao diện và SOAP Web Service/WSDL cho tích hợp hệ thống. Cơ sở dữ liệu sử dụng **Microsoft SQL Server**. Hệ thống có tích hợp OpenAI ChatGPT để gợi ý sản phẩm và MoMo để thanh toán.

## 1. Chức năng

- Đăng nhập/đăng xuất, session cookie, phân quyền Admin/Cashier.
- Quản lý sản phẩm, danh mục, thương hiệu, khách hàng và nhà cung cấp.
- Quản lý tồn kho theo lô, ngày sản xuất/hạn sử dụng; xuất kho FEFO.
- Lập hóa đơn, lịch sử hóa đơn, thống kê doanh thu và sản phẩm bán chạy.
- Cảnh báo lô sắp hết hạn/hết hạn và gửi email qua SMTP.
- ChatGPT tư vấn dựa trên danh mục sản phẩm còn hàng trong SQL Server. Kết quả gợi ý được lọc lại theo `productId` thật trong catalog.
- MoMo tạo URL thanh toán, lưu giao dịch, xác minh chữ ký HMAC-SHA256 ở IPN và cập nhật trạng thái hóa đơn.

## 2. Kiến trúc SOA

- `server.js`: HTTP host/API Gateway, session, REST routes và SOAP endpoints.
- `services/auth-service.js`: xác thực và khởi tạo tài khoản Admin.
- `services/inventory-service.js`: sản phẩm, lô hàng, tồn kho và FEFO.
- `services/order-service.js`: hóa đơn và transaction SQL Server.
- `services/notification-service.js`: cảnh báo hạn dùng/email.
- `services/management-service.js`: danh mục, thương hiệu, khách hàng, nhà cung cấp, dashboard.
- `services/ai-service.js`: gọi OpenAI Chat Completions và lọc gợi ý theo catalog.
- `services/payment-service.js`: tích hợp MoMo, xác minh chữ ký và đối soát IPN.
- `services/db.js`: SQL Server connection pool, Windows Integrated Authentication và tham số hóa truy vấn. Tham số truy vấn được đặt tên `@appParam0`, `@appParam1`,...; tránh mẫu `@p{n}` vì node-mssql dành mẫu đó cho nội bộ driver.

Đây là SOA dạng modular monolith: các service được phân tách theo nghiệp vụ nhưng cùng chạy trong một tiến trình Node.js và dùng chung SQL Server. SOAP và REST là hai giao diện tích hợp; đây không phải các microservice triển khai độc lập.

## 3. Yêu cầu môi trường Windows

- Node.js 20, 22 hoặc 24 (Windows 64-bit) và npm.
- Microsoft SQL Server (Express/Developer/Standard đều được).
- SQL Server Management Studio (SSMS).
- Microsoft ODBC Driver 18 for SQL Server (hoặc đổi `DB_ODBC_DRIVER` sang đúng tên driver đã cài).
- Windows account đang chạy Node.js phải được cấp quyền truy cập database `makeup_store`.

`DB_SERVER=localhost` giả định bạn đang dùng SQL Server **default instance** trên chính máy tính. Nếu SQL Server là named instance, điền đúng tên, ví dụ `localhost\SQLEXPRESS`.

## 4. Tạo database và chạy dự án

### Bước 1 — Tạo database bằng SSMS

1. Mở SQL Server Management Studio.
2. Kết nối tới Server name `localhost` bằng `Windows Authentication`.
3. Mở file `db-schema.sql` trong SSMS.
4. Nhấn **Execute** (F5). Script sẽ tạo database `makeup_store` và các bảng nếu chúng chưa tồn tại.

Các bảng chính: `users`, `products`, `inventory_batches`, `bills`, `bill_items`, `alert_logs`, `categories`, `brands`, `suppliers`, `customers`, `payment_transactions`.

### Bước 2 — Cài/kiểm tra ODBC Driver

Mở trang [Microsoft ODBC Driver for SQL Server](https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server) và cài bản Windows x64 của ODBC Driver 18. Sau đó mở Start Menu → **ODBC Data Sources (64-bit)** → tab **Drivers** để xác nhận tên `ODBC Driver 18 for SQL Server`. Nếu chỉ cài Driver 17, chỉnh `DB_ODBC_DRIVER=ODBC Driver 17 for SQL Server` trong `.env`.

### Bước 3 — Kiểm tra dịch vụ và quyền Windows Authentication

Mở SQL Server Configuration Manager → SQL Server Services và bảo đảm dịch vụ SQL Server đang chạy. Nếu cần kết nối qua TCP/IP, vào SQL Server Network Configuration → Protocols for MSSQLSERVER → bật TCP/IP rồi khởi động lại dịch vụ SQL Server.

Node.js sử dụng tài khoản Windows đang mở terminal. Nếu SSMS kết nối được bằng Windows Authentication nhưng ứng dụng không kết nối được, kiểm tra SQL Server có login tương ứng cho tài khoản Windows này và login có quyền trên database `makeup_store` (ít nhất `db_datareader`, `db_datawriter`; để chạy script tạo database cần quyền phù hợp).

### Bước 4 — Cấu hình biến môi trường

Sao chép `.env.example` thành `.env`:

```powershell
Copy-Item .env.example .env
```

Cấu hình SQL Server theo thiết lập đã cung cấp:

```env
DB_SERVER=localhost
DB_NAME=makeup_store
DB_AUTH=windows
DB_ODBC_DRIVER=ODBC Driver 18 for SQL Server
DB_ENCRYPT=yes
DB_TRUST_SERVER_CERTIFICATE=yes
```

Với Windows Authentication, không cần `DB_USER` và `DB_PASSWORD`. Node.js phải được chạy bằng tài khoản Windows đã được cấp quyền trong SQL Server. `DB_TRUST_SERVER_CERTIFICATE=yes` phù hợp cho môi trường local/demo; production nên dùng chứng chỉ máy chủ hợp lệ.

Đồng thời đặt `SESSION_SECRET` và đổi `ADMIN_PASSWORD` trước khi sử dụng. Không chia sẻ file `.env`.

### Bước 5 — Cài đặt và chạy

Mở terminal tại thư mục chứa `package.json`:

```powershell
npm install
npm run check
npm run db:test
npm start
```

Mở `http://localhost:3000`. Health check: `http://localhost:3000/api/health`.

Khi chạy lần đầu, ứng dụng tạo tài khoản Admin theo `ADMIN_EMAIL` và `ADMIN_PASSWORD` trong `.env`, đồng thời thêm một số sản phẩm mẫu nếu bảng `products` đang trống. Đổi mật khẩu sau lần đăng nhập đầu tiên.

Lệnh `npm run db:test` kiểm tra kết nối, tên database, tài khoản Windows và một truy vấn có tham số (chuỗi, số, NULL) trước khi chạy website.

### Lỗi kết nối thường gặp

- `IM002 Data source name not found`: chưa cài ODBC Driver hoặc `DB_ODBC_DRIVER` không khớp tên driver trong ODBC Data Sources.
- `-2146893019` / `certificate chain was issued by an authority that is not trusted`: lỗi chứng chỉ TLS tự ký thường gặp với ODBC Driver 18. Bản này truyền trực tiếp `Encrypt` và `TrustServerCertificate` trong ODBC connection string. Với máy local/demo có thể đặt `DB_TRUST_SERVER_CERTIFICATE=yes`; không dùng chế độ bỏ xác thực chứng chỉ cho production.
- `Login failed for user`: tài khoản Windows đang chạy Node.js chưa được tạo/cấp quyền trong SQL Server.
- `Server not found` / `ECONNREFUSED` / timeout: kiểm tra SQL Server Service đang chạy; bật TCP/IP trong SQL Server Configuration Manager nếu cần; xác nhận server/instance đúng.
- `Database schema is incomplete`: chạy `db-schema.sql` trong SSMS và chắc chắn đang kết nối database `makeup_store`.
- Không dùng cổng MySQL `3306`; cấu hình này dành cho Microsoft SQL Server.

## 5. Cấu hình ChatGPT AI

Điền trong `.env`:

```env
OPENAI_API_KEY=your_server_side_api_key
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_URL=https://api.openai.com/v1/chat/completions
```

Mở `/ai-assistant.html`. API `POST /api/ai/recommend` nhận body ví dụ:

```json
{
  "message": "Tôi muốn kem chống nắng cho da dầu dưới 300000đ",
  "skinType": "Da dầu",
  "budget": 300000,
  "concerns": "kiềm dầu, không bí da",
  "category": "Chống nắng"
}
```

API key chỉ nằm ở backend. Endpoint có giới hạn cơ bản 12 yêu cầu/IP/phút. AI là công cụ tư vấn tham khảo, không chẩn đoán bệnh da liễu.

## 6. Cấu hình MoMo Sandbox

Dùng thông tin tích hợp do MoMo cấp cho môi trường sandbox và điền `.env`:

```env
MOMO_PARTNER_CODE=...
MOMO_ACCESS_KEY=...
MOMO_SECRET_KEY=...
MOMO_CREATE_URL=https://test-payment.momo.vn/v2/gateway/api/create
MOMO_REDIRECT_URL=https://your-public-url/payment-result.html
MOMO_IPN_URL=https://your-public-url/api/payments/momo/ipn
```

Luồng thanh toán: nhân viên tạo hóa đơn → backend tạo yêu cầu và trả `payUrl` → trình duyệt chuyển khách đến MoMo → MoMo redirect về trang kết quả để hiển thị → MoMo gọi IPN server-to-server → backend xác minh chữ ký và cập nhật giao dịch/hóa đơn. Không xem redirect trình duyệt là bằng chứng đã thanh toán; trạng thái phải dựa trên IPN hợp lệ.

Khi demo từ máy cá nhân qua Cloudflare Tunnel/ngrok, IPN URL phải là địa chỉ HTTPS công khai đang hoạt động. URL tunnel thay đổi thì cập nhật lại `MOMO_REDIRECT_URL`, `MOMO_IPN_URL` và `APP_BASE_URL`, sau đó khởi động lại Node.js để WSDL dùng base URL mới.

## 7. REST API chính

| Method | Endpoint | Quyền | Mục đích |
|---|---|---|---|
| POST | `/api/auth/login` | Public | Đăng nhập |
| GET | `/api/products` | Public | Danh sách sản phẩm/tồn |
| POST/PUT/DELETE | `/api/products` | Admin | CRUD sản phẩm |
| GET/POST | `/api/inventory/batches` | Login/Admin | Xem/thêm lô |
| POST | `/api/bills` | Login | Tạo hóa đơn, trừ kho FEFO |
| GET | `/api/bills` | Login | Lịch sử hóa đơn |
| GET/POST/PUT/DELETE | `/api/customers` | Admin | Quản lý khách hàng |
| GET/POST/PUT/DELETE | `/api/categories` | Admin | Quản lý danh mục |
| GET/POST/PUT/DELETE | `/api/brands` | Admin | Quản lý thương hiệu |
| GET/POST/PUT/DELETE | `/api/suppliers` | Admin | Quản lý nhà cung cấp |
| GET | `/api/reports/dashboard` | Admin | Tổng quan |
| GET | `/api/reports/revenue?days=30` | Admin | Doanh thu theo ngày |
| POST | `/api/ai/recommend` | Public, rate limited | Gợi ý sản phẩm AI |
| POST | `/api/payments/momo/create` | Login | Tạo yêu cầu thanh toán |
| POST | `/api/payments/momo/ipn` | MoMo callback + signature | Xác nhận giao dịch |
| GET | `/api/payments` | Admin | Lịch sử giao dịch |
| GET | `/api/health` | Public | Health check SQL Server |

## 8. SOAP Web Services / WSDL

Import các URL sau vào SoapUI:

- `http://localhost:3000/soap/auth?wsdl` — `LoginUser`
- `http://localhost:3000/soap/inventory?wsdl` — `GetProducts`, `GetBatches`, `AddBatch`, `GetExpiryAlerts`
- `http://localhost:3000/soap/order?wsdl` — `CreateBill`, `GetBills`
- `http://localhost:3000/soap/notification?wsdl` — `SendExpiryAlert`, `GetExpiryAlerts`
- `http://localhost:3000/soap/management?wsdl` — `GetCategories`, `GetBrands`, `GetSuppliers`, `GetCustomers`, `GetDashboard`
- `http://localhost:3000/soap/ai?wsdl` — `RecommendProducts`
- `http://localhost:3000/soap/payment?wsdl` — `CreateMomoPayment`, `GetPayments`

SOAP operation sử dụng `payload` (JSON serialize thành chuỗi) và `result` (JSON serialize thành chuỗi). Các thao tác quản trị yêu cầu tài khoản Admin. SOAP AI nhận payload giống REST AI; SOAP Payment nhận thông tin đăng nhập và `billId`.

## 9. Giao diện

- `/index.html`: bán hàng/lập hóa đơn.
- `/login.html`: đăng nhập.
- `/admin.html`: quản lý sản phẩm.
- `/inventory.html`: quản lý lô và hạn sử dụng.
- `/management.html`: dashboard, khách hàng, danh mục, thương hiệu, nhà cung cấp.
- `/ai-assistant.html`: giao diện tư vấn ChatGPT.
- `/payment-result.html`: trang trả kết quả từ MoMo.

## 10. Kiểm thử trước khi nghiệm thu

- Đăng nhập sai/đúng; cashier gọi API admin phải nhận 403.
- Thêm/sửa/xóa sản phẩm, danh mục, thương hiệu, khách hàng, nhà cung cấp.
- Lập hóa đơn đủ hàng; lập hóa đơn vượt tồn; kiểm tra FEFO và rollback transaction.
- Kiểm tra dữ liệu, khóa ngoại và tồn kho trong SSMS sau khi tạo hóa đơn.
- AI chỉ gợi ý `productId` thuộc catalog còn hàng; thử thiếu API key và lỗi OpenAI.
- MoMo sandbox: thành công, thất bại, chữ ký sai, IPN gửi lặp, orderId không tồn tại.
- Import từng WSDL vào SoapUI và kiểm tra operation hợp lệ/không hợp lệ.
- Kiểm tra doanh thu và top sản phẩm sau khi tạo hóa đơn.

## 11. Triển khai

Để đưa website lên Internet, triển khai Node.js trên máy chủ có thể truy cập công khai và cấu hình SQL Server phù hợp. Nếu dùng Cloudflare Tunnel trên máy cá nhân để demo, cả Node.js, SQL Server và tunnel đều phải đang chạy. Không mở cổng SQL Server trực tiếp ra Internet. Không lưu API key/secret ở frontend. MoMo yêu cầu redirect/IPN URL công khai HTTPS; ChatGPT API key chỉ đặt tại backend.
