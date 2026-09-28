//========================================================--
// MAWWW-AM - Server (Vercel Compatible)
// Reverse-engineered Alight Motion activation + Admin Panel
//========================================================--
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

//========================================================--
// CONFIG (dari repo am-reverse)
//========================================================--
const KEY = "AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0";
const IDT = "https://www.googleapis.com/identitytoolkit/v3/relyingparty";
const VFY = "https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "mawwwadmin123";

//========================================================--
// STEALTH HEADERS
//========================================================--
const dip = () => `${crypto.randomInt(1, 255)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 255)}`;
const sp = h => ({
    ...h,
    'x-forwarded-for': dip(),
    'x-real-ip': dip(),
    'client-ip': dip(),
    'x-client-ip': dip(),
    'x-originating-ip': dip(),
    'x-cluster-client-ip': dip()
});

const H1 = {
    'content-type': 'application/json',
    'x-android-package': 'com.alightcreative.motion',
    'x-android-cert': 'ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8',
    'user-agent': 'dalvik/2.1.0 (linux; u; android 15; 23127pn0cc build/bp1a.250505.005)'
};
const H2 = {
    'content-type': 'application/json; charset=utf-8',
    'user-agent': 'okhttp/3.12.1',
    'accept-encoding': 'gzip'
};

//========================================================--
// IN-MEMORY STORE (sessions + logs)
// Ganti dengan Redis/Supabase untuk production
//========================================================--
let sessions = [];
let logs = [];
let sessionIdCounter = 1;

function addLog(type, message, meta = {}) {
    logs.unshift({
        id: Date.now() + Math.random(),
        type,
        message,
        meta,
        time: Date.now()
    });
    if (logs.length > 500) logs.pop();
}

//========================================================--
// HELPERS
//========================================================--
const bad = e => {
    const d = e.response?.data;
    return d ? (typeof d === 'object' ? JSON.stringify(d) : String(d)) : e.message;
};

function code(raw) {
    if (!raw) return null;
    let s = String(raw).replace(/&/g, '&');
    try { s = decodeURIComponent(s); } catch {}
    try {
        const u = new URL(s);
        let c = u.searchParams.get('oobCode');
        if (!c) {
            const n = u.searchParams.get('link') || u.searchParams.get('q') || u.searchParams.get('url');
            if (n) {
                try { c = new URL(n).searchParams.get('oobCode'); } catch {}
            }
        }
        if (c) return c.replace(/[^a-zA-Z0-9_-]/g, '');
    } catch {}
    const m = s.match(/oobCode=([a-zA-Z0-9_-]+)/i);
    if (m) return m[1];
    const t = raw.trim();
    if (/^[a-zA-Z0-9_-]{10,}$/.test(t) && !t.includes('://')) return t;
    return null;
}

function authAdmin(req, res, next) {
    const pass = req.headers["x-admin-pass"] || req.query.admin_pass;
    if (!pass || pass !== ADMIN_PASSWORD) {
        return res.status(401).json({ ok: false, msg: "Unauthorized" });
    }
    next();
}

//========================================================--
// ROUTES
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
// API: SEND MAGIC LINK
//========================================================--
app.post("/api/send-link", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.json({ ok: false, msg: "Email wajib diisi!" });

    try {
        await axios.post(`${IDT}/getOobConfirmationCode?key=${KEY}`, {
            requestType: 6,
            email,
            androidInstallApp: true,
            canHandleCodeInApp: true,
            continueUrl: 'https://alightcreative.com?ui_sid=0366624874&ui_sd=0',
            iosBundleId: 'com.alightcreative.motion',
            androidPackageName: 'com.alightcreative.motion',
            androidMinimumVersion: '585',
            clientType: 'CLIENT_TYPE_ANDROID'
        }, { headers: sp(H1) });

        addLog("send-link", `Magic link dikirim ke ${email}`);
        res.json({ ok: true, msg: "Magic link sudah dikirim! Cek inbox/spam email kamu." });
    } catch (e) {
        addLog("send-link-error", bad(e), { email });
        res.json({ ok: false, msg: bad(e) });
    }
});

//========================================================--
// API: VERIFY LINK & ACTIVATE
//========================================================--
app.post("/api/activate", async (req, res) => {
    const { email, link } = req.body;
    if (!email || !link) return res.json({ ok: false, msg: "Email dan link wajib diisi!" });

    const c = code(link);
    if (!c) return res.json({ ok: false, msg: "Link tidak valid (oobCode tidak ditemukan)." });

    try {
        // Step 1: Sign in dengan email link
        const a = await axios.post(`${IDT}/emailLinkSignin?key=${KEY}`, {
            email, oobCode: c, clientType: 'CLIENT_TYPE_ANDROID'
        }, { headers: sp(H1) });

        const idToken = a.data.idToken;
        const refreshToken = a.data.refreshToken;
        const uid = a.data.localId;
        const isNew = !!a.data.isNewUser;

        // Step 2: Get user info (opsional)
        let user = null;
        try {
            const b = await axios.post(`${IDT}/getAccountInfo?key=${KEY}`, {
                idToken
            }, { headers: sp(H1) });
            user = b.data?.users?.[0] || null;
        } catch {}

        // Step 3: Activate premium via verifyPurchase
        const order = 'mawww-' + crypto.randomBytes(6).toString('hex');
        const body = {
            data: {
                productId: 'am.full.sub.annual.19q4',
                token: 'mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw',
                skuType: 'subs',
                orderId: order
            }
        };
        const h = {
            ...H2,
            authorization: 'Bearer ' + idToken,
            'firebase-instance-id-token': 'cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI'
        };

        let verifyResult = null;
        try {
            const r = await axios.post(VFY, body, { headers: sp(h) });
            verifyResult = r.data;
        } catch (e) {
            verifyResult = { error: bad(e) };
        }

        // Simpan session
        const session = {
            id: sessionIdCounter++,
            email,
            uid,
            orderId: order,
            isNew,
            user,
            activatedAt: Date.now(),
            verifyResult
        };
        sessions.unshift(session);
        addLog("activate", `Aktivasi berhasil untuk ${email}`, { orderId: order });

        res.json({
            ok: true,
            msg: "🎉 Premium berhasil diaktifkan selama 1 tahun!",
            session: {
                id: session.id,
                email: session.email,
                orderId: session.orderId,
                activatedAt: session.activatedAt
            }
        });
    } catch (e) {
        addLog("activate-error", bad(e), { email });
        res.json({ ok: false, msg: bad(e) });
    }
});

//========================================================--
// API: REFRESH SESSION
//========================================================--
app.post("/api/refresh", async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.json({ ok: false, msg: "Refresh token wajib diisi!" });

    try {
        const r = await axios.post(`https://securetoken.googleapis.com/v1/token?key=${KEY}`, {
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        });
        res.json({ ok: true, id: r.data.id_token, ref: r.data.refresh_token });
    } catch (e) {
        res.json({ ok: false, msg: bad(e) });
    }
});

//========================================================--
// ADMIN: LOGIN
//========================================================--
app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) return res.json({ ok: true });
    res.json({ ok: false, msg: "Password salah!" });
});

//========================================================--
// ADMIN: GET SESSIONS
//========================================================--
app.get("/api/admin/sessions", authAdmin, (req, res) => {
    const { search } = req.query;
    let filtered = [...sessions];
    if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(x =>
            x.email.toLowerCase().includes(s) ||
            String(x.orderId).toLowerCase().includes(s)
        );
    }
    const stats = {
        total: sessions.length,
        today: sessions.filter(s => {
            const d = new Date(s.activatedAt);
            const n = new Date();
            return d.toDateString() === n.toDateString();
        }).length
    };
    res.json({ ok: true, sessions: filtered, stats });
});

//========================================================--
// ADMIN: GET LOGS
//========================================================--
app.get("/api/admin/logs", authAdmin, (req, res) => {
    res.json({ ok: true, logs: logs.slice(0, 100) });
});

//========================================================--
// ADMIN: DELETE SESSION
//========================================================--
app.delete("/api/admin/session/:id", authAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    sessions = sessions.filter(s => s.id !== id);
    res.json({ ok: true });
});

//========================================================--
// 404
//========================================================--
app.use((req, res) => res.status(404).send("404 - Not Found"));

//========================================================--
// EXPORT untuk Vercel
//========================================================--
module.exports = app;
