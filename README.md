# PLC Control – Hệ Thống Quản Lý Phiên Bản File PLC

> 🔧 Mini Git Server nội bộ dành cho kỹ sư PLC – Chạy 24/7 trong mạng LAN

---

## 📋 Tổng Quan

**PLC Control** là hệ thống quản lý phiên bản file tương tự Git, được xây dựng cho doanh nghiệp sản xuất để:

- **Upload & theo dõi** lịch sử thay đổi file PLC (`.cxp`, `.prg`, `.gp`, `.zip`, Word, Excel, v.v.)
- **Version control**: mỗi lần upload → tạo version mới, có lịch sử đầy đủ
- **Diff view**: so sánh nội dung giữa 2 phiên bản (text diff highlight)
- **Restore**: khôi phục về phiên bản cũ, lưu backup
- **Phân quyền**: Admin / Kỹ sư (User) / Chỉ xem (Viewer)
- **Audit log**: ghi lại toàn bộ hoạt động hệ thống
- **Đa ngôn ngữ**: Tiếng Việt. Trung & English
- **Font đa ngôn ngữ**: Hỗ trợ Tiếng Việt và Tiếng Trung

---

## 🏗️ Kiến Trúc Hệ Thống

```
┌─────────────────────────────────────────────────────────────┐
│                     PLC Control Server                       │
│                                                             │
│  ┌───────────────┐      ┌─────────────────────────────────┐ │
│  │   Frontend    │      │          Backend                │ │
│  │  React + Vite │─────▶│   Node.js + Express             │ │
│  │  Ant Design   │      │   REST API                      │ │
│  │  (Port 3000)  │      │   (Port 3001)                   │ │
│  └───────────────┘      └──────────┬──────────────────────┘ │
│                                    │                         │
│                         ┌──────────▼──────────┐             │
│                         │      SQLite DB       │             │
│                         │  ./data/plc.db       │             │
│                         └──────────────────────┘             │
│                                    │                         │
│                         ┌──────────▼──────────┐             │
│                         │   File Storage       │             │
│                         │  ./uploads/          │             │
│                         └──────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

### Stack Công Nghệ

| Layer       | Technology                     |
|-------------|-------------------------------|
| Backend     | Node.js 18+ / Express 4        |
| Database    | SQLite (better-sqlite3)        |
| Storage     | Local disk                    |
| Auth        | JWT (access + refresh tokens)  |
| Frontend    | React 18 + Vite 8              |
| UI Library  | Ant Design 5                  |
| Diff View   | diff2html                     |
| Font        | Inter, Noto Sans, Noto Sans SC |

---

## 📁 Cấu Trúc Project

```
PLC-Control/
├── backend/
│   ├── src/
│   │   ├── config/         # Cấu hình (port, JWT, storage)
│   │   ├── middleware/      # Auth, error handler
│   │   ├── models/         # Database schema + init
│   │   ├── routes/         # API routes
│   │   ├── controllers/    # Business logic
│   │   └── utils/          # Logger, file utils, cleanup, diff
│   ├── .env.example        # Template biến môi trường
│   ├── package.json
│   └── server.js           # Entry point
│
├── frontend/
│   ├── src/
│   │   ├── api/            # Axios client
│   │   ├── components/     # Layout, CommitGraph, FileDiff
│   │   ├── contexts/       # AuthContext, LangContext
│   │   ├── locales/        # vi.js, en.js (i18n)
│   │   ├── pages/          # Login, Dashboard, Files, FileDetail, History, Users, Profile
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── .gitignore
└── README.md
```

---

## ⚙️ Yêu Cầu Môi Trường

| Software    | Version  | Notes                         |
|-------------|----------|-------------------------------|
| Node.js     | >= 18.x  | Khuyến nghị LTS 20.x hoặc 22.x |
| npm         | >= 9.x   | Đi kèm Node.js                |
| OS          | Windows 10/11, Windows Server 2016+, hoặc Linux |

> ⚠️ **Trên Windows**: `better-sqlite3` cần build native module.
> Cài [Visual C++ Build Tools](https://aka.ms/vs/17/release/vs_BuildTools.exe) nếu gặp lỗi khi `npm install`.

---

## 🚀 Cài Đặt & Chạy

### 1. Clone / Tải Source Code

```bash
git clone <repo-url>
cd PLC-Control
```

### 2. Cài Đặt Backend

```bash
cd backend
npm install
cp .env.example .env
```

**Chỉnh sửa file `.env`** (bắt buộc đổi JWT_SECRET, khuyến nghị đổi mật khẩu admin):

```env
PORT=3001
HOST=0.0.0.0

JWT_SECRET=your-very-long-random-secret-key-here

ADMIN_USERNAME=admin
ADMIN_PASSWORD=Admin@123456
ADMIN_DISPLAY_NAME=Administrator
```

### 3. Cài Đặt & Build Frontend

```bash
cd ../frontend
npm install
npm run build
```

### 4. Chạy Server

```bash
cd ../backend
npm start
```

Server khởi động tại: **http://localhost:3001**

Truy cập từ máy khác trong mạng LAN: **http://\<IP-server\>:3001**

---

## 🔧 Chạy Development Mode

Mở **2 terminal**:

**Terminal 1 – Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 – Frontend (hot reload):**
```bash
cd frontend
npm run dev
```

Truy cập: **http://localhost:3000**

---

## 🖥️ Deploy Trên Windows Server

### Cách 1: Chạy trực tiếp

```powershell
cd C:\PLC-Control\backend
npm install
copy .env.example .env
# Chỉnh .env
npm start
```

### Cách 2: Chạy như Windows Service với PM2

```powershell
npm install -g pm2
npm install -g pm2-windows-startup

cd C:\PLC-Control\backend
pm2 start server.js --name "plc-control"
pm2 save
pm2-startup install
```

### Cách 3: Tạo file start.bat

```batch
@echo off
cd /d C:\PLC-Control\backend
node server.js
pause
```

Đặt shortcut vào Startup folder: `Win+R` → `shell:startup`

---

## 🌐 Cấu Hình IP / Port

File `backend/.env`:

```env
# Lắng nghe tất cả network interfaces
HOST=0.0.0.0
PORT=3001
```

Truy cập qua: `http://10.x.x.x:3001`

### Mở Firewall Windows

```powershell
netsh advfirewall firewall add rule name="PLC Control" dir=in action=allow protocol=TCP localport=3001
```

---

## 📊 Database Schema

```sql
users         (id, username, password_hash, display_name, role, avatar_url, is_active, created_at)
files         (id, name, path, description, created_by, created_at, updated_at, is_deleted, deleted_by, deleted_at)
versions      (id, file_id, version_number, storage_path, size, checksum, mime_type, is_binary, commit_message, uploaded_by, created_at)
activity_log  (id, user_id, action, entity_type, entity_id, entity_name, details, created_at)
refresh_tokens(id, user_id, token_hash, expires_at, created_at)
```

---

## 🔑 Phân Quyền

| Chức năng                | Admin | User/Kỹ sư | Viewer |
|--------------------------|-------|------------|--------|
| Xem danh sách file       | ✅    | ✅         | ✅     |
| Upload file / version    | ✅    | ✅         | ❌     |
| Xóa file                 | ✅    | ✅ (của mình) | ❌  |
| Restore phiên bản        | ✅    | ✅         | ❌     |
| Download file            | ✅    | ✅         | ✅     |
| Xem lịch sử + diff       | ✅    | ✅         | ✅     |
| Quản lý người dùng       | ✅    | ❌         | ❌     |

---

## 📡 API Reference

### Auth
```
POST /api/auth/login         { username, password }
POST /api/auth/refresh       { refreshToken }
POST /api/auth/logout        (auth)
GET  /api/auth/me            (auth)
```

### Files
```
GET    /api/files            (auth) ?search=&page=&limit=
POST   /api/files            (auth) multipart: file, commitMessage, description, filePath
GET    /api/files/:id        (auth)
DELETE /api/files/:id        (auth)
GET    /api/files/stats      (auth)
GET    /api/files/activity   (auth) ?page=&limit=&fileId=
```

### Versions
```
GET  /api/versions/:id              (auth)
GET  /api/versions/:id/download     (auth)
GET  /api/versions/diff?fromId=&toId= (auth)
POST /api/versions/:id/restore      (auth)
```

### Users (Admin)
```
GET    /api/users            (admin)
POST   /api/users            (admin) { username, password, displayName, role }
PUT    /api/users/:id        (admin)
DELETE /api/users/:id        (admin)
PUT    /api/users/me/profile (auth)  { displayName?, avatarUrl? }
PUT    /api/users/me/password (auth) { currentPassword, newPassword }
```

---

## 🗃️ Quy Tắc Lưu Trữ & Dọn Dẹp

| Quy tắc                         | Mặc định       |
|---------------------------------|----------------|
| Giữ tối đa N phiên bản/file     | 10 versions    |
| Thời gian lưu tối đa            | 365 ngày       |
| Lịch chạy dọn dẹp               | Hàng ngày 02:00 |

Chỉnh trong `backend/.env`:
```env
MAX_VERSIONS_PER_FILE=10
MAX_RETENTION_DAYS=365
```

---

## 🔒 Bảo Mật

- Mật khẩu hash bằng **bcrypt** (rounds: 10)
- JWT access token: **8 giờ** / refresh token: **7 ngày**
- Token rotation trên mỗi refresh
- Rate limiting: 500 req/15min (API), 30 req/15min (login)
- HTTP security headers qua **Helmet.js**
- CORS configurable

---

## 📝 Hướng Dẫn Sử Dụng Nhanh

### Đăng nhập lần đầu

- URL: `http://server-ip:3001`
- Username: `admin` / Password: `Admin@123456`
- ⚠️ **Đổi mật khẩu ngay!**

### Upload file mới

1. Menu **Quản lý file** → **Tải lên file**
2. Kéo thả hoặc chọn file
3. Nhập đường dẫn: `/chuyền-1/máy-A`
4. Nhập ghi chú thay đổi → **Tải lên**

### Upload phiên bản mới của file đã có

1. Mở chi tiết file → **Tải lên phiên bản mới**
2. Chọn file cùng tên → Tự động tạo version mới

### So sánh 2 phiên bản

1. Mở chi tiết file
2. Click chọn 2 node trong biểu đồ commit
3. Tab **So sánh thay đổi** → **So sánh**

### Khôi phục phiên bản cũ

1. Trong danh sách phiên bản → click icon **Khôi phục**
2. Xác nhận → Tạo version mới với nội dung cũ

---

## 🔧 Troubleshooting

**Lỗi native module trên Windows:**
```bash
npm install --global windows-build-tools
npm install
```

**Không truy cập từ máy khác:**
1. Kiểm tra `HOST=0.0.0.0` trong `.env`
2. Mở port 3001 trong Windows Firewall

**Reset database:**
```bash
rm backend/data/plc_control.db
npm start  # Tự tạo lại DB + admin user
```

---

## 📜 License

MIT License – Tự do sử dụng cho mục đích nội bộ doanh nghiệp.
