# ITop Med — o'rnatish, klinika ochish, shifokor va registratorni ulash

Avval bitta narsani aniq tushunib oling. **Bitta klinikada dastur faqat BITTA joyda turadi.** Shifokor va registrator uni o'z kompyuteridan *ochadi*, qayta o'rnatmaydi.
Agar dasturni ikkita kompyuterga alohida o'rnatsangiz, ikkita **alohida** baza paydo bo'ladi. Registrator yozgan bemorni shifokor ko'rmaydi, chunki ular bir-biriga ulanmaydi. Shunday qilmang.

Klinikani ishga tushirishning 2 yo'li bor, bittasini tanlang:

| | **1-yo'l: Internet (server)** | **2-yo'l: Lokal (klinika kompyuterida)** |
|---|---|---|
| Qayerda turadi | https://itopmed.itoppos.uz | Klinikadagi bitta asosiy kompyuterda |
| Internet kerakmi | Ha, hamma qurilmada | Yo'q. Faqat bitta Wi-Fi yoki bitta tarmoq kerak |
| Uydan ishlash | Mumkin | Yo'q, faqat klinika ichida |
| O'rnatish | Hech narsa o'rnatilmaydi | Bitta kompyuterga zip fayl ochiladi |
| Ma'lumot | Serverda | Faqat shu kompyuterda |

---

## 1-yo'l. Internet orqali (server) — eng oson

### Siz (SuperAdmin): yangi klinika ochish — 2 daqiqa
1. https://itopmed.itoppos.uz/admin/login → login va parolingiz bilan kiring.
2. **Klinikalar → Yangi klinika** bo'limida:
   - klinika nomini yozing;
   - turini tanlang (kabinet / stomatologiya / diagnostika / ko'p tarmoqli);
   - yo'nalishini tanlang, masalan Kardiologiya;
   - egasining ismi, logini va parolini yozing;
   - **parol**ni yozing yoki tayyorini qoldiring va yozib oling.
3. **Klinikani yaratish** tugmasini bosing.
4. Egaga 3 narsani bering:
   - manzil: **https://itopmed.itoppos.uz/login**
   - login
   - parol

### Klinika egasi: birinchi kirish
1. https://itopmed.itoppos.uz/login → login va parol bilan kiradi.
3. **Xizmatlar va narxlar** bo'limida narxlarni qo'yadi.

### Shifokor va registratorni qo'shish (klinika egasi qiladi)
**Xodimlar** bo'limida har bir xodim uchun:
1. Xodimning ismi, logini va parolini yozing.
2. Rolini belgilang:
   - Registrator → **Registrator** va **Kassir**;
   - Shifokor → **Shifokor**;
   - bosh shifokor bo'lsa, qo'shimcha ravishda **Bosh shifokor**.
3. Kirish usulida **«Parolni hozir beraman»**ni tanlang. Parolni yozib oling.
4. **Xodimni qo'shish** tugmasini bosing.
5. Xodimga **manzil, login va parol**ni qog'ozda bering.

Shifokor uchun yana bir qadam bor: **Shifokorlar** bo'limida mutaxassisligi va qabul jadvalini kiriting. Shundan keyin u navbatda ko'rinadi.

### Ular qanday ishlaydi
- Registrator o'z kompyuteri yoki telefonidan https://itopmed.itoppos.uz/login ni ochadi → **Qabulxona** bo'limiga kiradi.
- Shifokor o'z kompyuterida xuddi shu manzilni ochadi → **Bugungi bemorlarim** bo'limiga kiradi.
- Registrator bemorni yozib, to'lovni oladi. Bemor **shu zahoti** shifokorning ro'yxatida paydo bo'ladi, hammasi bitta bazada.
- Qulaylik uchun brauzer menyusida **«Ilovani o'rnatish»**ni tanlang. Ish stolida ITop Med belgisi paydo bo'ladi.

---

## 2-yo'l. Lokal — internet kerak emas

### Mijozga berish
1. Siz o'z kompyuteringizda `npm run package:win` buyrug'ini ishga tushirasiz. Natijada **`dist\ITopMed-Windows.zip`** fayli tayyor bo'ladi; uni Telegram orqali yuboring.

### O'rnatish — faqat BITTA asosiy kompyuterga
Odatda bu registratura kompyuteri bo'ladi, chunki u kun bo'yi yoniq turadi.

1. Zip faylni oching: o'ng tugma → **Extract All**, masalan `C:\ITopMed` papkasiga.
2. **ITop Med.exe** ni ikki marta bosing.
   - Agar "Windows protected your PC" chiqsa: **More info → Run anyway**.
3. Bitta forma chiqadi. Klinika nomi, turi, ism, login va parolni yozib, **Klinikani yaratish** tugmasini bosing.
   - Shu bilan klinika ochiladi, siz esa uning egasi bo'lasiz. Alohida "yangi klinika" ochish shart emas.
4. Windows ruxsat so'rasa, **Ha** ni bosing. Busiz boshqa qurilmalar ulana olmaydi.
5. **Sozlamalar → «Ma'lumotlar qayerda saqlanadi»** bo'limida **Lokal** belgilangan bo'ladi. Bu holatda internetga hech narsa ketmaydi.

### Shifokor va registratorni qo'shish
1-yo'ldagi kabi: **Xodimlar → «Parolni hozir beraman»**.

### Shifokorning kompyuterini ulash — dastur o'rnatilmaydi
1. Shifokor kompyuteri asosiy kompyuter bilan **bitta Wi-Fi yoki bitta tarmoq**da bo'lishi kerak.
2. Asosiy kompyuterdagi kirish sahifasida **«Telefon yoki planshetni ulash»** tugmasini bosing. Ekranda manzil chiqadi, masalan `http://192.168.1.10/connect`.
3. Shifokor kompyuterida brauzerni (Chrome yoki Edge) ochib, **shu manzilni** yozing.
4. Ekrandagi 4 qadamni bajaring:
   1. sertifikatni yuklab oling;
   2. faylni oching → **Sertifikatni o'rnatish → Joriy foydalanuvchi → «Ishonchli ildiz sertifikat markazlari»**;
   3. **ITop Med'ni ochish** tugmasini bosing;
   4. **Ilovani o'rnatish**ni tanlang.
5. Shifokor o'z logini va paroli bilan kiradi.

Telefon va planshet ham shunday ulanadi: shu manzilni telefon brauzerida ochasiz.

---

## Muammo chiqadimi? Bo'lishi mumkin bo'lganlari va yechimi

| Muammo | Sababi | Yechim |
|---|---|---|
| Shifokor registrator yozgan bemorni ko'rmayapti | Dastur 2 ta kompyuterga alohida o'rnatilgan | Faqat bitta asosiy kompyuter qoldiring. Qolganlari brauzer orqali ulansin |
| Shifokor ro'yxatida bemor yo'q | Bemor boshqa shifokorga yozilgan, yoki **Shifokorlar** bo'limida profil to'ldirilmagan | Qabulxonada to'g'ri shifokorni tanlang. Shifokor profilini to'ldiring |
| Lokal rejimda boshqa kompyuter ochmayapti | Asosiy kompyuter o'chiq, boshqa Wi-Fi'da, yoki Windows ruxsat berilmagan | Asosiy kompyuterni yoqing. Bitta tarmoqqa ulang. Kirish sahifasidagi **«Telefon yoki planshetni ulash»** sahifasini ochib, kerak bo'lsa ruxsatni qayta bering |
| Kecha ishlagan, bugun ochilmayapti (lokal) | Router asosiy kompyuterga yangi IP manzil bergan | Ulanish sahifasidagi yangi manzilni oching. Doimiy hal qilish: routerda shu kompyuterga **doimiy IP** bering (DHCP reservation) |
| Asosiy kompyuter o'chsa | Dastur faqat unda turadi | Ish vaqtida asosiy kompyuter yoniq tursin. Uyqu rejimini o'chiring |
| Xodim parolini unutdi | — | Ega **Xodimlar** bo'limida uning hisobini o'chiradi va yangi parol bilan qayta qo'shadi |
| Ma'lumot yo'qolishidan qo'rqasiz | — | Har kuni avtomatik shifrlangan zaxira olinadi. Lokalda `%LOCALAPPDATA%\ITopMed\backups` papkasini haftada bir fleshkaga ko'chiring |

**Halol cheklovlar:**
- Lokal rejimda klinikadan tashqaridan ulanib bo'lmaydi.
- Chek fiskal emas.
- SMS va onlayn to'lov hali yo'q.
- Kompyuter Windows 10 yoki 11, 64-bit bo'lishi kerak.
