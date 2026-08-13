# Vazifalar — loyihalar kesimida ish rejasi

Qog'ozdagi varaqlar o'rniga: har bir loyiha uchun alohida ro'yxat, ichida mavzular,
mavzular ichida vazifalar. Hammasi bitta daraxt ko'rinishida, bir qarashda ko'rinadi.

Desktop dastur (Electron). Ma'lumotlar **kompyuterning o'zida**, lokal SQLite bazasida
saqlanadi — server ham, internet ham kerak emas.

## Imkoniyatlar

- **Daraxt ko'rinishi** — Loyiha › Mavzu › Vazifa. "Hammasi" bo'limida barcha loyihalar birdan ko'rinadi.
- **Muddat (deadline)** — ixtiyoriy sana va vaqt. Muddat yaqinlashganda rangi o'zgaradi:
  - `⚠ 3 kun kechikdi` — qizil
  - `🔔 Bugun` — qizil, pulslanadi
  - `⏰ Ertaga` / `⏰ 2 kun qoldi` — sariq (necha kun oldin ogohlantirish — sozlamalarda)
  - `📅 payshanba · 4 kun` — kulrang
- **Eslatma oynasi** — muddat payti kelganda ekran markazida, barcha oynalar ustida chiqadi
  va **OK bosilmaguncha yopilmaydi**. Windows toast'idan farqli: o'zi yo'qolib ketmaydi va
  "Focus assist" kabi tizim sozlamalari uni to'sib qo'ymaydi. Qachon chiqadi:

  | Holat | Eslatma vaqti |
  |---|---|
  | Vaqt qo'yilgan (masalan 17:40) | aynan o'sha vaqtda |
  | Vaqtsiz, bugungi ish | ertalab 9:00 da |
  | Muddati o'tgan | dastur ochilishi bilan darhol |
  | Oldindan ogohlantirish | muddatdan N kun oldin, 9:00 da (N — sozlamalarda) |

  Bitta vazifa uchun kuniga bir marta. Sozlamalarda **"Sinab ko'rish"** tugmasi va
  **"Windows bilan birga ishga tushsin"** imkoniyati bor (eslatma dastur ochiq
  turgandagina chiqadi).
- **Takrorlanuvchi ishlar** — har kuni / har hafta / har oy / har yil.
  Bajarilgan deb belgilanganda vazifa "Bajarilgan"ga tushadi
  va o'rniga keyingi muddat bilan yangisi ochiladi; **vaqti (masalan 09:00) saqlanadi**.
  Hisob rejalashtirilgan muddatdan olinadi — kechikib bajarilsa ham "har dushanba"
  dushanbaligicha qoladi. Oy oxiri to'g'ri hisoblanadi (31-yanvar → 28/29-fevral).
- **Bajarilgan ishlar** — belgilangan vazifa loyihaning "✓ Bajarilgan" bo'limiga ko'chadi.
- **Qidiruv** — barcha loyihalar bo'ylab sarlavha, izoh, mavzu va loyiha nomi bo'yicha.
- **Tez ko'rinishlar** — Bugun, Yaqin 7 kun, Muddati o'tgan.
- **O'chirish** — vazifa, mavzu yoki butun loyihani. Tasodifiy o'chirilsa "Qaytarish" tugmasi bor.
- **Sudrab ko'chirish** — vazifani mavzudan mavzuga, loyihadan loyihaga; loyihalar tartibini ham.
- **Muhimlik** — Oddiy / O'rta / Yuqori.
- **Izoh** — har bir vazifaga qo'shimcha matn.
- **Yorug'/qorong'i mavzu**, oyna o'lchami eslab qolinadi.
- **Zaxira nusxa** — JSON faylga saqlash va fayldan tiklash.

## Tezkor tugmalar

| Tugma | Vazifasi |
|---|---|
| `Ctrl + N` | Yangi vazifa (birinchi qo'shish maydoniga o'tadi) |
| `Ctrl + Shift + N` | Yangi loyiha |
| `Ctrl + F` | Qidiruv |
| `Enter` | Vazifani saqlash (qo'shish maydoni ochiq qoladi — ketma-ket yozish uchun) |
| `Esc` | Qidiruvni tozalash / tafsilotni yopish / oynani yopish |

## Ishga tushirish (ishlab chiqish)

```bash
npm install
npm start
```

> Eslatma: agar tizimda `ELECTRON_RUN_AS_NODE=1` o'zgaruvchisi o'rnatilgan bo'lsa,
> Electron oynasi ochilmaydi. `npm start` buni o'zi hisobga oladi (`scripts/start.js`).

## Tarqatish — fleshka orqali

```bash
npm run dist
```

Natija:

```
release/
├── Vazifalar-Setup-1.0.0.exe      o'rnatuvchi
└── FLESHKAGA/                     <- shu papkani fleshkaga ko'chiring
    ├── Vazifalar-Setup-1.0.0.exe
    └── OQING.txt                  o'rnatish yo'riqnomasi (o'zbekcha)
```

O'rnatuvchi haqida:

- **Administrator paroli so'ralmaydi** — dastur foydalanuvchi profiliga o'rnatiladi.
- **Internet kerak emas** — hech qanday yangilanish serveri yo'q.
- Ish stoliga va Пуск menyusiga yorliq o'zi qo'yiladi.
- Dastur o'chirilsa ham **vazifalar saqlanib qoladi**.
- Har bir kompyuterda mustaqil baza — fleshkada hech kimning ma'lumoti ko'chmaydi.

Windows imzolanmagan dasturga "Windows protected your PC" ogohlantirishini
ko'rsatadi — `OQING.txt` da buni qanday o'tish yozilgan (Подробнее → Выполнить в любом случае).

## Tekshiruv

```bash
node scripts/db-test.js      # 30 ta: migratsiya, takrorlanish sanasi, eslatma vaqti (Electron kerak emas)
node scripts/smoke.js        # 40 ta funksional tekshiruv (interfeys bilan birga)
node scripts/make-icon.js    # build/icon.ico ni qayta yasash
```

## Tuzilishi

```
src/
  main/
    main.js      Electron oynasi, IPC, bildirishnomalar
    db.js        SQLite sxemasi va barcha so'rovlar
    preload.js   Renderer uchun xavfsiz API (contextIsolation)
  renderer/
    index.html
    styles.css
    app.js       Interfeys: daraxt, qidiruv, tahrirlash, sudrab ko'chirish
scripts/
  start.js       Toza muhitda ishga tushirish
  smoke.js       Tekshiruv rejimi
  smoke-checks.js
```

## Ma'lumotlar qayerda?

`%APPDATA%\vazifalar\vazifalar.db` — SQLite fayli.
Aniq yo'lni dasturning **Sozlamalar** oynasidan ko'rish va papkasini ochish mumkin.

Zaxira nusxa uchun shu faylni nusxalash yoki Sozlamalar → Zaxira nusxa → Saqlash yetarli.
