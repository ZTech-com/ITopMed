# Farhod MedServis — ishga tushirish (qisqa)

Manzil: **https://itopmed.itoppos.uz/login** (internet orqali). Hech narsa o'rnatilmaydi.

## 0. Klinikani ochish (serverda, 1 marta, ~1 daqiqa)
Serverga kiring (`ssh root@45.138.158.60`) va bitta buyruqni bajaring. Email va ismni Farhod akaniki bilan almashtiring:
```bash
/opt/itopmed/bin/itopmed-clinic farhod-medservis farhod-email@example.uz "Qoraboyev Farhod"
```
- Buyruq Farhod aka uchun **parol** so'raydi (2 marta). Parol kamida 12 belgidan iborat bo'lsin va ichida harf ham, raqam ham bo'lsin. Yozganda ekranda ko'rinmaydi — bu normal.
- Klinika tayyor holda ochiladi:
  - **Xizmatlar va narxlar**:
    - Kardiolog ko'ruvi — 100 000
    - Umumiy ayollar UZI — 100 000
    - Umumiy erkaklar UZI — 100 000
    - EXO — 120 000
    - Buyraklar UZI — 70 000
    - Hazm tizimi UZI — 70 000
    - Moyaklar UZI — 70 000
    - Qalqonsimon bez UZI — 70 000
    - Prostata bezi UZI — 70 000
    - EKG — 30 000
  - **"Kardiolog ko'ruvi"** blanki (narxsiz chop etiladi) va ko'rik shablonlari.
  - **Farhod aka** quyidagi rollarni oladi:
    - klinika egasi;
    - shifokor (kardiolog);
    - bosh shifokor;
    - registrator va kassir — ya'ni qabulxona funksiyalari ham, to'lovlar ham unda bor.

## 1. Klinikada — Farhod akaning kompyuterida (10 daqiqa)
1. Chrome yoki Edge'da **itopmed.itoppos.uz/login** ni oching → email va parol bilan kiring.
2. Telefoniga **Google Authenticator** o'rnating → ekrandagi QR kodni skanerlang → 6 xonali kodni kiriting.
3. **Tiklash kodlarini yarating** → qog'ozga yozib, seyfga qo'ying.
4. **Sozlamalar** bo'limida:
   - klinika manzili va telefonini yozing;
   - **"Hujjat blanki"** → logotip va litsenziya qatori.
5. **Shifokorlar va jadval** → ish kunlari va soatlarini tekshiring. Standart: Du–Ju, 9:00–18:00. Shanba ishlasa, qo'shing.
6. **Shablonlar** → **"Kardiolog ko'ruvi"** → kerak bo'lsa pastiga qo'shimcha qator yozing. Masalan: `Tel: +998 .. ... .. .. (Telegram savollar uchun)`.
7. Brauzer menyusidan **"Ilovani o'rnatish"** ni tanlang — ish stolida ITop Med belgisi paydo bo'ladi.

## 2. Registratorni qo'shish (2 daqiqa)
1. **Xodimlar** bo'limida registratorning ismi va emailini yozing.
2. Rollaridan **Registrator** va **Kassir** ni belgilang.
3. Kirish usulida **"Parolni hozir beraman"** ni tanlang → parolni qog'ozga yozing → **Xodimni qo'shish**.
4. Registrator o'z kompyuterida **itopmed.itoppos.uz/login** ni ochadi → shu email va parol bilan kiradi → **Qabulxona** bo'limi ochiladi. Unga Google Authenticator kerak emas.

## 3. Printerlar
- **A4 printer** (ko'rik varag'i va retsept uchun) va **chek printeri** (80 yoki 58 mm) Windows'ga odatdagidek ulanadi.
- Chop etish oynasida kerakli printerni tanlaysiz:
  - talon va chek → chek printeri;
  - "Kardiolog ko'ruvi" varag'i → A4 printer.
- Chek **fiskal emas** (soliq kassasi emas).

## 4. Birinchi bemor bilan sinab ko'ring
1. **Registrator — Qabulxona** sahifasida:
   - familiya, ism, tug'ilgan yili (masalan 1958) va manzilni yozing;
   - xizmatlarni belgilang;
   - to'lovni tanlang: **to'liq / qisman / qarzga**;
   - bosim, vazn, bo'y, pulsni yozing;
   - **Navbatga qo'shish** → navbat raqami chiqadi → **talon** va **chek**ni chop eting.
2. **Shifokor — Bugungi bemorlarim** sahifasida:
   - bemor kirmasdan oldin uning yoshi, bosimi, to'lovi va qarzi ko'rinadi;
   - **Qabulni boshlash** → shablon → yozing → **Imzolash**;
   - tashxis va retseptni qo'shing;
   - kerak bo'lsa **EXO / EKG**'ni qo'shing (to'lab yoki qarzga);
   - **"Kardiolog ko'ruvi"** varag'ini chop etib, bemorga bering. Unda narx yo'q.
3. **Qarz:** registratorning navbat ro'yxatida bemor tagidagi **"Qarzni olish"** → to'lovni qabul qilish.
4. **Excel:**
   - bemor kartasida → **Excel** tugmasi;
   - **Sozlamalar** → «Barcha bemorlarni Excel'da yuklab olish (ZIP)».

## Muammo bo'lsa
- **Kira olmayapti:**
  - email yoki parolni tekshiring;
  - xodim parolini unutsa: **Xodimlar** → xodimni oching → **"Yangi parol berish"**.
- **Farhod aka telefonini yo'qotsa:** tiklash kodlaridan biri bilan kiradi.
- **Internet uzilsa:** sayt ishlamaydi. Internet qaytgach, hammasi joyida bo'ladi — ma'lumot serverda saqlanadi. Har kuni 03:30 da zaxira nusxa olinadi.
