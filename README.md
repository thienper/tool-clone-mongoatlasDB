# 🍃 MongoDB Atlas Migration Tool

A web-based tool to **copy/migrate data between two MongoDB Atlas accounts** — no CLI or `mongodump` required. Just paste connection strings, pick your databases, and go.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?logo=node.js)
![MongoDB](https://img.shields.io/badge/MongoDB-Driver%207-green?logo=mongodb)
![License](https://img.shields.io/badge/License-ISC-blue)

---

## ✨ Features

- 🔌 **Auto-connect** — paste a connection string and instantly see all available databases
- 🗄️ **Database picker** — select from a list or create a brand-new database on the fly
- 📂 **Collection selector** — choose exactly which collections to migrate (or migrate all)
- 📊 **Real-time progress** — live log stream via Server-Sent Events (SSE)
- 🔑 **Index migration** — copies indexes alongside documents
- ⚡ **Batch processing** — migrates in chunks of 500 docs for memory efficiency
- 🗑️ **Drop existing** — optional flag to clear destination collections before import

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- Two MongoDB Atlas connection strings (source & destination)

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/mongo-migration-tool.git
cd mongo-migration-tool
npm install
```

### Run

```bash
npm start
```

Then open **http://localhost:3000** in your browser.

---

## 🖥️ Usage

**Step 1 — Connect & Select Database**

- Paste the **Source** connection string → click "Kết nối & Tải danh sách DB"
- Pick a database from the list (or create a new one)
- Repeat for the **Destination** connection string

**Step 2 — Choose Collections**

- Select individual collections or migrate all at once

**Step 3 — Confirm & Migrate**

- Review source/destination info
- Toggle "Drop existing data" if needed
- Click **Start Migration** 🚀

**Step 4 — Watch real-time progress**

- Live log output, doc counts, elapsed time, and error tracking

---

## 📁 Project Structure

```
mongo-migration-tool/
├── server.js        # Express backend + migration logic
├── public/
│   └── index.html   # Frontend UI (vanilla HTML/CSS/JS)
├── package.json
└── README.md
```

---

## ⚙️ API Endpoints

| Method | Endpoint                  | Description                      |
| ------ | ------------------------- | -------------------------------- |
| POST   | `/api/list-databases`   | Connect and return all databases |
| POST   | `/api/collections-info` | List collections with doc counts |
| POST   | `/api/migrate`          | Start migration job              |
| GET    | `/api/progress/:jobId`  | SSE stream for real-time updates |

---

## ⚠️ Notes

- The source Atlas user must have **read** access; the destination user must have **readWrite** access
- Make sure your Atlas cluster's **Network Access** allows connections from your IP (`0.0.0.0/0` for open access)
- Very large collections (millions of docs) may take several minutes — keep the browser tab open

---

## License

ISC © [Your Name]
