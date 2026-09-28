//========================================================--
// MAWWW-AM - Manual Activation Server (Vercel Compatible)
//========================================================--
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

//========================================================--
// CONFIG
//========================================================--
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "mawwwadmin123";
const OWNER_WA       = "62895618962380";

//========================================================--
// IN-MEMORY STORAGE
//========================================================--
let requests = [];
let requestIdCounter = 1;

//========================================================--
// HELPERS
//========================================================--
function authAdmin(req, res, next) {
    const pass = req.headers["x-admin-pass"] || req.query.admin_pass;
    if (!pass || pass !== ADMIN_PASSWORD) {
        return res.status(401).json({ ok: false, msg: "Unauthorized" });
    }
    next();
}

//========================================================--
// PUBLIC ROUTES
//========================================================--
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/health", (req, res) => {
    res.json({ ok: true, time: Date.now() });
});

//========================================================--
// SUBMIT REQUEST
//========================================================--
app.post("/api/request", (req, res) => {
    const { email, whatsapp, note } = req.body;

    if (!email || !whatsapp) {
        return res.json({ ok: false, msg: "Email dan WhatsApp wajib diisi!" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.json({ ok: false, msg: "Format email tidak valid!" });
    }

    const existing = requests.find(r => r.email.toLowerCase() === email.toLowerCase() && r.status !== "rejected");
    if (existing) {
        return res.json({
            ok: false,
            msg: "Email sudah pernah didaftarkan. Cek status di bawah!",
            requestId: existing.id
        });
    }

    const request = {
        id: requestIdCounter++,
        email: email.toLowerCase().trim(),
        whatsapp: whatsapp.trim(),
        note: (note || "").substring(0, 200),
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    requests.push(request);

    const waMessage = encodeURIComponent(
        `Halo Owner Mawww-AM,\n\n` +
        `Saya ingin request aktivasi.\n\n` +
        `📧 Email: ${email}\n` +
        `📱 WA: ${whatsapp}\n` +
        `📝 Note: ${note || "-"}\n` +
        `🆔 ID: #${request.id}`
    );
    const waLink = `https://wa.me/${OWNER_WA}?text=${waMessage}`;

    res.json({
        ok: true,
        msg: "Request berhasil dikirim!",
        requestId: request.id,
        waLink: waLink
    });
});

//========================================================--
// CHECK STATUS
//========================================================--
app.get("/api/status", (req, res) => {
    const email = (req.query.email || "").toLowerCase().trim();
    if (!email) {
        return res.json({ ok: false, msg: "Email wajib diisi!" });
    }

    const request = requests.find(r => r.email === email);
    if (!request) {
        return res.json({ ok: false, msg: "Email belum terdaftar." });
    }

    res.json({ ok: true, request });
});

//========================================================--
// ADMIN: LOGIN
//========================================================--
app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        return res.json({ ok: true });
    }
    res.json({ ok: false, msg: "Password salah!" });
});

//========================================================--
// ADMIN: LIST REQUESTS
//========================================================--
app.get("/api/admin/requests", authAdmin, (req, res) => {
    const { status, search } = req.query;
    let filtered = [...requests];

    if (status && status !== "all") {
        filtered = filtered.filter(r => r.status === status);
    }
    if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(r =>
            r.email.includes(s) ||
            r.whatsapp.includes(s) ||
            String(r.id).includes(s)
        );
    }

    filtered.sort((a, b) => b.createdAt - a.createdAt);

    const stats = {
        total: requests.length,
        pending: requests.filter(r => r.status === "pending").length,
        processing: requests.filter(r => r.status === "processing").length,
        approved: requests.filter(r => r.status === "approved").length,
        rejected: requests.filter(r => r.status === "rejected").length,
    };

    res.json({ ok: true, requests: filtered, stats });
});

//========================================================--
// ADMIN: UPDATE STATUS
//========================================================--
app.post("/api/admin/update/:id", authAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const { status } = req.body;

    if (!["pending", "processing", "approved", "rejected"].includes(status)) {
        return res.json({ ok: false, msg: "Status tidak valid." });
    }

    const request = requests.find(r => r.id === id);
    if (!request) {
        return res.json({ ok: false, msg: "Request tidak ditemukan." });
    }

    request.status = status;
    request.updatedAt = Date.now();

    res.json({ ok: true, request });
});

//========================================================--
// ADMIN: DELETE
//========================================================--
app.delete("/api/admin/delete/:id", authAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    requests = requests.filter(r => r.id !== id);
    res.json({ ok: true });
});

//========================================================--
// 404
//========================================================--
app.use((req, res) => {
    res.status(404).send("404 - Not Found");
});

//========================================================--
// EXPORT untuk Vercel
//========================================================--
module.exports = app;
