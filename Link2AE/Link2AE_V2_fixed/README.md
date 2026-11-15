# Link2AE

Extension panel untuk **Adobe After Effects CC 2017** yang memungkinkan Anda
mengunduh gambar langsung dari URL dan mengimpornya ke **Project Panel** After
Effects tanpa berpindah aplikasi.

Dibangun dengan **CEP 6** (runtime yang dikirim bersama AE CC 2017), HTML/CSS/
JavaScript ES5, dan **ExtendScript (.jsx)**. Tidak memerlukan plugin berbayar
maupun software tambahan.

---

## 1. Ringkasan Fitur

- Input URL (HTTP/HTTPS) dengan validasi.
- Tombol **Download**, **Download & Import**, dan **Clear**.
- Tekan **Enter** pada kolom URL untuk mulai download.
- Unduh gambar ke folder cache lokal: `~/Link2AE/cache` (Windows:
  `C:\Users\<Anda>\Link2AE\cache`).
- Nama file unik otomatis (timestamp + angka acak) agar tidak menimpa file lama.
- Mendukung redirect, query string (`?size=large`), dan batas ukuran file.
- Progress bar + status teks, serta pesan error yang jelas (403/404, timeout,
  host tidak ditemukan, URL bukan gambar, format tidak didukung, dll.).
- Import ke **Project Panel** AE via `ImportOptions` + `app.project.importFile()`.
- **Tidak** membuat layer timeline secara otomatis dan **tidak** mengubah atau
  menghapus project Anda.
- Mencegah import ganda dalam satu sesi AE.
- Riwayat download (nama file, format, ukuran, status import) yang tersimpan di
  disk dan tetap ada setelah AE ditutup/dibuka.
- Tiap item riwayat punya tombol **Import**, **Open Folder**, **Remove from
  History**. Menghapus dari riwayat **tidak** menghapus file.

---

## 2. Kompatibilitas

| Item | Nilai |
|------|-------|
| Host | Adobe After Effects **CC 2017 (14.0)** |
| Host ID manifest | `AEFT` |
| CEP runtime | **CEP 6** (`RequiredRuntime Name="CSXS" Version="6.0"`) |
| Chromium/CEF | Chromium 41 (CEF 3, branch 2272) |
| Node.js | IO.js 1.2.0 (Node-WebKit 0.12.1) — kode JS panel ditulis **ES5** |

> Catatan teknis: AE CC 2017 memakai **CEP 6**, bukan 7/8. Manifest sengaja
> memakai `RequiredRuntime` `6.0`. Jika Anda memakai `7.0` atau lebih tinggi,
> panel **tidak akan dimuat** di AE 2017. Ekstensi ini juga kompatibel dengan
> versi AE yang lebih baru (batas host `[13.0,99.9]`) tanpa perubahan.

---

## 3. Struktur Folder

```
Link2AE/
├── CSXS/
│   ├── manifest.xml            # manifest CEP 6 (wajib ada di folder CSXS)
│   └── com.yanszz.link2ae.debug # untuk remote debugging (opsional)
├── index.html                  # UI panel
├── css/
│   └── style.css               # dark theme, aksen ungu
├── js/
│   ├── CSInterface.js          # jembatan CEP <-> panel (adaptasi resmi Adobe)
│   ├── downloader.js           # downloader Node.js (http/https), ES5
│   └── main.js                 # logika UI, orkestrasi, riwayat
├── jsx/
│   └── hostscript.jsx          # ExtendScript: import ke Project Panel
├── assets/
│   └── icons/
│       ├── icon-normal.svg
│       └── README.md
└── README.md
```

---

## 4. Instalasi Manual (Windows, AE CC 2017)

### 4.1 Salin folder ekstensi

Salin folder **`Link2AE`** ke salah satu lokasi berikut:

- **Per-user (disarankan, tidak perlu admin):**
  ```
  C:\Users\<Anda>\AppData\Roaming\Adobe\CEP\extensions\Link2AE
  ```
- **Semua user (butuh hak administrator):**
  ```
  C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\Link2AE
  ```

> Pastikan `manifest.xml` berada di dalam folder `Link2AE\CSXS\`. Struktur akhir:
> `...\extensions\Link2AE\CSXS\manifest.xml`.

**Cara cepat (opsional):** jalankan `install-windows.bat` yang ada di folder
`Link2AE` (klik dua kali). Skrip ini akan menyalin folder ke lokasi per-user dan
mengatur `PlayerDebugMode` untuk CEP 6 secara otomatis. Jika lebih suka manual,
ikuti langkah 4.2 dan 4.3 di bawah.

### 4.2 Aktifkan CEP extension yang belum ditandatangani (PlayerDebugMode)

AE 2017 memakai **CEP 6**. Untuk memuat ekstensi yang belum ditandatangani, set
nilai registry berikut menjadi string `1`:

1. Buka Registry Editor (`Win + R`, ketik `regedit`, Enter).
2. Buka kunci:
   ```
   HKEY_CURRENT_USER\Software\Adobe\CSXS.6
   ```
   (Jika kunci `CSXS.6` belum ada, buat baru: klik kanan pada `Adobe` → New →
   Key → beri nama `CSXS.6`.)
3. Di dalam `CSXS.6`, buat **String Value** baru:
   - Name: `PlayerDebugMode`
   - Value: `1`
4. Tutup regedit. **Tutup dan buka lagi After Effects** agar perubahan terbaca.

Alternatif cepat (Command Prompt, per-user):

```bat
reg add "HKEY_CURRENT_USER\Software\Adobe\CSXS.6" /v PlayerDebugMode /t REG_SZ /d 1 /f
```

### 4.3 Buka panel

Di After Effects, buka menu:

```
Window > Extensions > Link2AE
```

Panel akan muncul dan bisa di-**dock** ke workspace seperti panel lain (tarik
ke area panel, lalu simpan workspace jika diinginkan).

---

## 5. Penggunaan

1. Tempel **direct image URL** ke kolom URL, contoh:
   `https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png`
2. Klik **Download** untuk menyimpan ke cache, atau
   **Download & Import** untuk langsung mengimpor ke Project Panel.
   (Tekan **Enter** juga memulai download.)
3. Setelah sukses, gambar muncul di **Riwayat Download**. Dari sana Anda bisa:
   - **Import** — impor ke Project Panel kapan saja.
   - **Open Folder** — buka lokasi file di File Explorer.
   - **Remove from History** — hapus dari daftar (file tetap tersimpan).
4. Tombol ikon folder di header membuka seluruh folder cache.

> Penting: gunakan **URL gambar langsung** (yang mengembalikan file gambar,
> bukan halaman HTML). Jika URL mengarah ke halaman web, panel akan menampilkan
> pesan bahwa Anda memerlukan direct image URL.

---

## 6. Format Gambar yang Didukung

- **JPG / JPEG**, **PNG**, **GIF**, **BMP** — diunduh dan diimpor langsung ke
  AE CC 2017 (didukung penuh oleh `importFile`).
- **WebP** — file **berhasil diunduh & disimpan** ke cache, namun **AE CC 2017
  tidak mendukung impor WebP secara native**. Jika Anda menekan
  Download & Import untuk file WebP, panel akan menyimpan file lalu menampilkan
  pesan bahwa AE tidak dapat mengimpornya. Buka file tersebut di folder cache
  dan konversi ke PNG/JPG jika perlu.

> Ekstensi ini **tidak** melakukan konversi format. Ia hanya mengunduh dan
> menyimpan file apa adanya, lalu menyerahkan impor ke After Effects.

---

## 7. Keamanan & Stabilitas

- Hanya protokol **HTTP/HTTPS** yang diizinkan (validasi URL).
- Nama file di-*sanitize* (tanpa karakter berbahaya, mencegah path traversal).
- Path yang dikirim ke ExtendScript di-*escape* dengan aman (bukan `eval` data
  eksternal).
- Konten dari URL **tidak** dieksekusi sebagai kode.
- Batas ukuran file maksimum **100 MB**; download dibatalkan dan pesan
  ditampilkan bila terlampaui.
- Timeout 30 detik; error jaringan/timeout ditangani tanpa membuat panel crash.
- Project AE Anda **tidak** pernah dihapus, ditutup, atau ditimpa oleh ekstensi.

---

## 8. Jika Panel Tidak Muncul

1. Pastikan `manifest.xml` berada di `...\Link2AE\CSXS\manifest.xml`.
2. Pastikan **PlayerDebugMode** sudah di-set (bagian 4.2) untuk CEP **6**.
3. Tutup **seluruh** proses AE lalu buka lagi.
4. Periksa menu `Window > Extensions`. Jika tidak ada entri **Link2AE**, berarti
   manifest tidak terbaca — cek kembali struktur folder dan XML.
5. Jika muncul pesan "not properly signed", PlayerDebugMode belum aktif untuk
   CSXS.6.
6. Jika tetap gagal, aktifkan remote debugging dan buka konsol untuk melihat
   error.

### Membaca log / debugging

- File `.debug` sudah disertakan (`com.yanszz.link2ae.debug`) yang memetakan host
  `AEFT` ke port `8090`.
- Buka **Chrome/Chromium** ke alamat `http://localhost:8090` saat panel aktif,
  lalu klik nama ekstensi untuk membuka **DevTools** dan melihat `console.log`
  / error.
- Semua hasil import dikembalikan dari ExtendScript dan ditampilkan di panel.

---

## 9. Dependensi

- **CSInterface.js** — jembatan CEP. Disertakan secara lokal (adaptasi dari
  pustaka resmi Adobe v6.1.0, tanpa ketergantungan jQuery agar ringan).
- **Node.js (bawaan CEP 6)** — dipakai untuk mengunduh gambar via `http`/`https`
  sehingga bebas dari batasan CORS browser. Diaktifkan lewat `CEFCommandLine`
  di manifest (`--enable-nodejs --mixed-context`).
- **ExtendScript (hostscript.jsx)** — dipakai untuk impor ke Project Panel.

Tidak ada framework berat, tidak ada library pihak ketiga tambahan.

---

## 10. Catatan Implementasi (AE 2017)

- Semua kode JS ditulis **ES5** karena IO.js 1.2.0 / Chromium 41 di CEP 6 tidak
  mendukung banyak fitur ES6+ (mis. `let/const`, arrow function, template
  literal, `fs.mkdir` dengan opsi `recursive`).
- Folder cache dibuat secara bertahap (bukan `fs.mkdirSync(..., {recursive})`).
- Import memakai `app.project.importFile(new ImportOptions(file))`; AE 2017
  selalu punya project aktif (meski kosong), sehingga ekstensi **tidak** membuat
  atau menutup project untuk menghindari kehilangan pekerjaan Anda.
- Duplikat dicegah dengan mencatat path absolut yang sudah diimpor selama sesi
  ExtendScript berjalan.

---

## 11. Checklist Pengujian (AE CC 2017)

Centang setiap item setelah menguji di After Effects CC 2017 sungguhan:

- [ ] Panel muncul di **Window > Extensions > Link2AE**.
- [ ] Panel bisa di-dock ke workspace.
- [ ] URL gambar langsung (PNG/JPG) berhasil diunduh.
- [ ] File tersimpan di `C:\Users\<Anda>\Link2AE\cache` dengan nama unik.
- [ ] URL dengan query string (`...jpg?size=large`) berhasil diunduh.
- [ ] URL yang mengarah ke halaman web menampilkan pesan "perlu direct image URL".
- [ ] Tombol **Download & Import** memasukkan gambar ke **Project Panel**.
- [ ] **Tidak** ada layer yang otomatis muncul di timeline.
- [ ] Gambar tetap ada di riwayat setelah AE ditutup & dibuka lagi.
- [ ] Import gambar yang sama dua kali tidak menduplikasi item.
- [ ] URL invalid menampilkan error yang jelas.
- [ ] HTTP 404 / 403 menampilkan pesan yang sesuai.
- [ ] Host tidak ditemukan / matikan internet menampilkan error jaringan.
- [ ] Download yang gagal **tidak** membuat panel/AE crash.
- [ ] Tombol **Open Folder** membuka File Explorer di lokasi file.
- [ ] **Remove from History** menghapus item tapi **file tetap ada**.
- [ ] Ukuran kecil panel tetap nyaman dipakai (responsif).

> Peringatan jujur: ekstensi ini **belum dijalankan di After Effects sungguhan**
> pada lingkungan pembuatan ini. Logika mengikuti API CEP 6 / ExtendScript AE
> yang terdokumentasi dan ditulis agar kompatibel, namun silakan verifikasi
> sesuai checklist di atas.

---

## 12. Fitur Baru: Pinterest Image Downloader (V2)

Link2AE V2 menambahkan tab **Pinterest** yang memungkinkan Anda mengunduh gambar dari Pinterest dan mengimpornya ke After Effects.

### 12.1 URL yang Didukung

- **Short link:** `https://pin.it/xxxx` — sistem akan mengikuti redirect ke halaman pin asli.
- **Pin page:** `https://www.pinterest.com/pin/xxxxxx/` — sistem mengambil metadata gambar dari halaman pin.
- **Direct image URL:** URL gambar langsung dari Pinterest CDN (`pinimg.com`).

### 12.2 Cara Penggunaan

1. Buka tab **Pinterest** di panel Link2AE.
2. Masukkan URL Pinterest Pin ke kolom input.
3. Tekan tombol **Resolve** untuk mengurai URL dan mengambil metadata gambar.
4. Jika berhasil, pratinjau gambar akan ditampilkan bersama informasi (nama, resolusi, format, sumber, URL).
5. Tekan **Download** untuk menyimpan ke folder cache, atau **Download & Import** untuk langsung mengimpor ke Project Panel After Effects.
6. Tekan **Clear** untuk mengosongkan input dan pratinjau.

### 12.3 Batasan

- Tidak melewati login Pinterest.
- Tidak melewati CAPTCHA atau sistem keamanan.
- Tidak mengambil konten privat.
- Jika Pinterest menolak akses (HTTP 403) atau metadata tidak tersedia, akan ditampilkan pesan error yang jelas.
- Tidak semua URL Pinterest pasti dapat diproses (tergantung respons server Pinterest).

### 12.4 Struktur Folder (V2)

```
Link2AE/
├── CSXS/
│   ├── manifest.xml            # manifest CEP 6 (versi 2.0.0)
│   └── com.yanszz.link2ae.debug
├── index.html                  # UI panel dengan tab Images/Pinterest/History/Settings
├── css/
│   └── style.css               # dark theme + tab/preview/settings styles
├── js/
│   ├── CSInterface.js          # jembatan CEP <-> panel
│   ├── downloader.js           # downloader Node.js (ES5) + setMaxBytes/setTimeoutMs
│   ├── pinterest.js            # Pinterest URL Resolver (baru di V2)
│   └── main.js                 # logika UI, orkestrasi, riwayat, Pinterest handlers
├── jsx/
│   └── hostscript.jsx          # ExtendScript: import ke Project Panel
├── assets/
│   └── icons/
├── install-windows.bat
└── README.md
```

---


