# PLC Control — Hệ Thống Quản Lý Phiên Bản File PLC

> 🏭 Mini Git Server nội bộ dành cho kỹ sư PLC — Chạy 24/7 trong mạng LAN, không cần Internet

[![JavaScript](https://img.shields.io/badge/JavaScript-99.5%25-F7DF1E?logo=javascript&logoColor=black)](https://github.com/Orsted-LTA/PLC-Control)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![License](https://img.shields.io/badge/License-Private-red)](https://github.com/Orsted-LTA/PLC-Control)

---

## 📋 Tổng Quan

**PLC Control** là hệ thống quản lý phiên bản file nội bộ, được xây dựng cho môi trường sản xuất công nghiệp. Mỗi lần kỹ sư upload file PLC → hệ thống tự động tạo version mới, lưu toàn bộ lịch sử, cho phép so sánh và khôi phục bất kỳ phiên bản nào — tương tự Git nhưng dành riêng cho file máy PLC.

### ✨ Tính Năng Chính

| Tính năng | Mô tả |
|---|---|
| 📁 **Quản lý file & thư mục** | Cấu trúc Line → Machine, hỗ trợ mọi định dạng file PLC |
| 🔢 **Version Control** | Mỗi upload tạo version mới, lưu lịch sử đầy đủ với commit message |
| 🔍 **Diff View** | So sánh nội dung 2 phiên bản với highlight thay đổi, hỗ trợ fullscreen |
| 📄 **Office Diff** | Trích xuất và so sánh nội dung file Word, Excel, PowerPoint, CSV, RTF |
| ↩️ **Restore** | Khôi phục về bất kỳ phiên bản cũ nào, tự động tạo backup WAL |
| 🔒 **File Lock/Unlock** | Khóa file khi đang chỉnh sửa, ngăn xung đột giữa nhiều kỹ sư |
| 🔔 **Thông báo Real-time** | SSE (Server-Sent Events) hiển thị hoạt động tức thì |
| 🟢 **Trạng thái Online** | Xem ai đang online trong hệ thống theo thời gian thực |
| 💾 **Backup tự động** | Tự động backup DB theo lịch, có thể duyệt và khôi phục từ snapshot |
| 👥 **Phân quyền** | Admin / Kỹ sư (Editor) / Chỉ xem (Viewer) |
| 📊 **Dashboard & Audit Log** | Thống kê tổng quan và lịch sử toàn bộ hoạt động hệ thống |
| 🌐 **Đa ngôn ngữ** | Tiếng Việt 🇻🇳 · English 🇬🇧 · 中文 🇨🇳 |
| 📤 **Upload lớn** | Hỗ trợ file lên đến **5 GB** |

---

## 🏗️ Kiến Trúc Hệ Thống

```
┌──────────────────────────────────────────────────────────────┐
│                      PLC Control Server                       │
│                                                              │
│   ┌──────────────────┐      ┌────────────────────────────┐   │
│   │    Frontend      │      │         Backend            │   │
│   │  React 18 + Vite │─────▶│   Node.js + Express        │   │
│   │   Ant Design 5   │      │   REST API + SSE           │   │
│   │   (Port 3000)    │◀─────│   (Port 3001)              │   │
│   └──────────────────┘      └───────────┬────────────────┘   │
│                                         │                    │
│                              ┌──────────▼──────────┐        │
│                              │      SQLite DB       │        │
│                              │   ./data/plc.db      │        │
│                              └──────────┬───────────┘        │
│                                         │                    │
│                              ┌──────────▼──────────┐        │
│                              │    File Storage      │        │
│                              │   ./uploads/         │        │
│                              └─────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

### Stack Công Nghệ

| Layer | Technology |
|---|---|
| **Backend** | Node.js 18+ · Express 4 · better-sqlite3 |
| **Auth** | JWT (access token + refresh token) |
| **Real-time** | SSE (Server-Sent Events) |
| **Frontend** | React 18 · Vite · Ant Design 5 |
| **Diff Engine** | diff · diff2html |
| **Office Parser** | xlsx · mammoth · pptx2json |
| **Font** | Inter · Noto Sans · Noto Sans SC |

---

## 📁 Cấu Trúc Project

```
PLC-Control/
├── backend/
│   ├── src/
│   │   ├── config/         # Cấu hình port, JWT, storage
│   │   ├── middleware/     # Auth, error handler, SSE
│   │   ├── models/         # Database schema & khởi tạo
│   │   ├── routes/         # API routes
│   │   ├── controllers/    # Business logic
│   │   └── utils/          # Logger, file utils, diff, backup
│   ├── .env.example
│   ├── package.json
│   └── server.js
│
├── frontend/
│   ├── src/
│   │   ├── api/            # Axios client
│   │   ├── components/     # Layout, CommitGraph, FileDiff
│   │   ├── contexts/       # AuthContext, LangContext
│   │   ├── locales/        # vi.js · en.js · zh.js
│   │   └── pages/          # Login, Dashboard, Files, FileDetail,
│   │                       # History, Users, Profile, BackupViewer
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── .gitignore
└── README.md
```

---

## ⚙️ Yêu Cầu Môi Trường

| Software | Version | Ghi chú |
|---|---|---|
| Node.js | 18+ | LTS recommended |
| npm | 9+ | Đi kèm Node.js |
| OS | Windows / Linux / macOS | Đã test trên Windows Server & Ubuntu |

---

## 🚀 Cài Đặt & Chạy

### 1. Clone repo

```bash
git clone https://github.com/Orsted-LTA/PLC-Control.git
cd PLC-Control
```

### 2. Cài đặt Backend

```bash
cd backend
npm install
cp .env.example .env
# Chỉnh sửa .env nếu cần (port, JWT secret, v.v.)
```

### 3. Cài đặt Frontend

```bash
cd ../frontend
npm install
```

### 4. Chạy hệ thống

**Backend** (cổng 3001):
```bash
cd backend
node server.js
```

**Frontend** (cổng 3000):
```bash
cd frontend
npm run dev
```

Truy cập: `http://localhost:3000` hoặc `http://<IP-máy-chủ>:3000`

### 5. Tài khoản mặc định

| Vai trò | Username | Password |
|---|---|---|
| Admin | `admin` | `admin123` |

> ⚠️ **Đổi mật khẩu ngay sau lần đăng nhập đầu tiên!**

---

## 🗂️ Phân Quyền

| Quyền | Admin | Editor | Viewer |
|---|:---:|:---:|:---:|
| Xem file & lịch sử | ✅ | ✅ | ✅ |
| Upload version mới | ✅ | ✅ | ❌ |
| Khóa / Mở khóa file | ✅ | ✅ | ❌ |
| Khôi phục phiên bản | ✅ | ✅ | ❌ |
| Quản lý người dùng | ✅ | ❌ | ❌ |
| Xem Audit Log | ✅ | ❌ | ❌ |
| Backup & Restore DB | ✅ | ❌ | ❌ |

---

## 🔌 API Endpoints Chính

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/api/auth/login` | Đăng nhập |
| `GET` | `/api/files` | Danh sách file |
| `POST` | `/api/files` | Upload file / version mới |
| `GET` | `/api/files/:id` | Chi tiết file + lịch sử |
| `GET` | `/api/versions/diff` | So sánh 2 phiên bản |
| `POST` | `/api/versions/:id/restore` | Khôi phục phiên bản |
| `GET` | `/api/versions/:id/download` | Tải về |
| `POST` | `/api/files/:id/lock` | Khóa file |
| `POST` | `/api/files/:id/unlock` | Mở khóa file |
| `GET` | `/api/activity` | Audit log hoạt động |
| `GET` | `/api/sse/events` | Real-time SSE stream |
| `GET` | `/api/backups` | Danh sách backup |
| `POST` | `/api/backups/restore` | Khôi phục từ backup |

---

## 🖥️ Giao Diện

- **Dashboard** — Thống kê tổng quan: số file, phiên bản, dung lượng, hoạt động gần đây
- **Quản lý File** — Duyệt file theo cấu trúc Line/Machine, tìm kiếm, lọc
- **Chi tiết File** — Timeline phiên bản dạng Git graph, so sánh diff, khóa file
- **Diff Fullscreen** — Mở rộng toàn màn hình để đọc diff dễ hơn
- **Lịch sử Hoạt động** — Audit log toàn hệ thống
- **Quản lý Người dùng** — Tạo, phân quyền, vô hiệu hoá tài khoản (Admin)
- **Backup Viewer** — Duyệt và khôi phục file từ snapshot backup
- **Hồ sơ cá nhân** — Đổi tên, avatar, mật khẩu

---

## 🌐 Triển Khai Trong Mạng LAN

Hệ thống được thiết kế chạy trên HTTP thuần (không cần HTTPS) trong mạng nội bộ:

```bash
# Chạy backend lắng nghe tất cả interface
HOST=0.0.0.0 node server.js

# Kỹ sư truy cập từ máy khác trong mạng
http://192.168.1.100:3000
```

- ✅ Không cần Internet
- ✅ Không cần domain hay SSL
- ✅ Hỗ trợ tên file CJK (Tiếng Trung, Tiếng Việt có dấu)
- ✅ Tương thích Windows Server & Ubuntu

---

## 📝 Biến Môi Trường

```env
# backend/.env
PORT=3001
JWT_SECRET=your-secret-key-here
JWT_REFRESH_SECRET=your-refresh-secret-here
UPLOAD_DIR=./uploads
DATA_DIR=./data
BACKUP_DIR=./backups
```

---

## 📄 License

Dự án nội bộ — All rights reserved © 2026 Orsted-LTA