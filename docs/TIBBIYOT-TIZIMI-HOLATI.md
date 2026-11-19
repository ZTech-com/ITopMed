# Tibbiyot markazi boshqaruv tizimi — talablar bo'yicha holat

Har bir band uchun belgilar:
- ✅ — ishlaydi va testdan o'tgan;
- 🟡 — qisman yoki cheklov bilan;
- ⏳ — keyingi bosqich.

Arxitektura bitta:
- har bir klinika uchun yagona baza, ko'p filial, ko'p shifokor, xona va xodim;
- rollar alohida, har bir muhim harakat audit jurnaliga yoziladi.

## 1. Markaz
- ✅ Bitta xodimga bir nechta rol berish mumkin (masalan registrator + kassir), lekin tizimda rollar alohida.
- ✅ Shifokor, xona, filial va xodim qo'shish — sozlamalardan.

## 2. Bemorlarni ro'yxatga olish
- ✅ Familiya, ism, tug'ilgan yil (yoki to'liq sana), telefon.
- ✅ Kim yubordi: o'zi kelgan / shifokor / reklama / boshqa + izoh.
- ✅ Imtiyozli toifa.
- ✅ Takroriy tashrifda qidiruv bilan topiladi: F.I.Sh., telefon, karta raqami, tug'ilgan yil. O'xshash bemor bo'lsa, ogohlantirish chiqadi.
- ✅ Oldingi tashriflar va tibbiy tarix bemor kartasida ko'rinadi.

## 3. Navbat
- ✅ Onlayn va jonli navbat bitta jadvalda.
- ✅ Bir vaqtga ikki bemor yozilmaydi — buni bazaning o'zi taqiqlaydi.
- ✅ Onlayn band qilingan vaqt registraturada ham band ko'rinadi.
- ✅ Kutish zali uchun TV ekran (`/tv/<maxfiy havola>`): har 4 soniyada yangilanadi, ekranda bemorning faqat ismi va familiyasining bosh harfi chiqadi.
- ✅ Shifokorda **«Keyingi bemor»** va **«Qayta chaqirish»** tugmalari bor.
- ✅ Navbatlar o'zi yangilanib turadi.
- 🟡 Ovozli chaqiruv brauzer ovozi bilan ishlaydi (sinov rejimi). O'zbekcha ovoz kompyuterda o'zbek ovozi o'rnatilgan bo'lsa chiqadi, bo'lmasa turk yoki rus ovozida.

## 4. To'lov va kassa
- ✅ Registratura va kassa alohida rollar.
- ✅ To'lov xizmatlar kesimida hisoblanadi.
- ✅ Shifokor ko'rikdan keyin xizmat qo'shadi: to'lab yoki qarzga.
- ✅ Registrator yakuniy hujjatni chop etishi uchun ikki shart bajarilishi kerak:
  - shifokor qabulni yopgan bo'lishi;
  - har bir hisob to'langan yoki kassir qarzga ruxsat bergan bo'lishi.
- ✅ Barcha to'lovlar, qaytarishlar va kassa smenalari tarixi saqlanadi.
- ✅ Chegirmalar:
  - foizli chegirma;
  - imtiyozli toifa;
  - har bir chegirmaga sabab;
  - paketlar (hamma xizmatlari birga olinsa — paket foizi).
- ✅ Bepul qayta ko'rik:
  - birinchi pullik ko'rikdan keyin 10 kun ichida bepul (kunlar sonini klinika egasi o'zgartiradi);
  - keyin odatdagi narx;
  - istisno faqat ruxsati bor xodim tomonidan, sabab va kim ruxsat bergani bilan.
- ✅ 58 va 80 mm termoprinter cheki. Chek fiskal emas.

## 5. Shifokor ko'rigi
- ✅ Shablonlar.
- ✅ Tez tanlash: shikoyatlar, yurak va o'pka auskultatsiyasi, shishlar. Bitta bosishda matnga qo'shiladi, keyin erkin tahrirlanadi.
- ✅ Oldingi ko'rikdan nusxalash: faqat bo'sh bo'limlarga.
- ✅ Taxminiy tashxis taklifi faqat o'lchangan yoki anamnezda yozilgan ma'lumotdan:
  - bosim ≥ 140/90 → I10;
  - BMI ≥ 30 → E66;
  - diabet → E10 yoki E11;
  - o'tkazilgan infarkt → I25.2;
  - chekish → Z72.0.

  Shifokor tasdiqlamaguncha hech narsa yozilmaydi.
- ✅ Anamnez: homiladorlik (va muddati), oldingi infarkt, qandli diabet, chekish, gipertoniya davomiyligi, irsiy kasalliklar, operatsiyalar. Dori allergiyasi alohida yoziladi va retseptda ogohlantiradi.
- ✅ Obyektiv ko'rik:
  - qon bosimi ikkala qo'lda;
  - puls, SpO₂, bo'y, vazn;
  - BMI avtomatik;
  - bel aylanasi;
  - auskultatsiya va shish uchun tayyor iboralar.

## 6. Qabulxona / birlamchi ko'rik
- ✅ Alohida "Hamshira / qabulxona" sahifasi:
  - bosim ikkala qo'lda, puls, SpO₂, bo'y, vazn;
  - berilgan birlamchi yordam va dorilar jurnali (o'chirib bo'lmaydi);
  - shifokor buyurgan EKG, UZI va boshqa xizmatlarni hisobga qo'shish (pulni kassir oladi).

## 7. Kalkulyatorlar
Barchasi nashr etilgan formulalar asosida, manbalari ko'rsatilgan va namunaviy misollar bilan testdan o'tgan. Ma'lumot yetishmasa, hisoblanmaydi.
- ✅ BMI (WHO).
- ✅ SKF CKD-EPI 2021 + KDIGO bosqichi; Cockcroft–Gault.
- ✅ CHA₂DS₂-VASc, HAS-BLED.
- ✅ EF toifasi (ESC 2021), NYHA.
- ✅ QTc (Bazett, Fridericia), o'rtacha arterial bosim, qo'llar orasidagi farq.
- ⏳ SCORE2 va boshqa xavf shkalalari. Ular uchun rasmiy koeffitsiyent jadvallari kerak — taxmin qilib qo'yilmaydi.

## 8. Tashxislar
- ✅ Tashxis kodi va nomi; asosiy, hamroh yoki asorat; bosqich/daraja.
- ✅ Klinikada ko'p ishlatiladigan tashxislar bitta bosishda tanlanadi.
- ✅ Hammasi statistika uchun bazada saqlanadi.
- ⏳ **To'liq MKB-10 bazasi.** Kodlarni o'zimizdan to'qib chiqarmaslik uchun rasmiy fayl kerak: Sog'liqni saqlash vazirligi yoki WHO'ning MKB-10 ro'yxati (rus yoki o'zbek tilida). Fayl berilsa, import va qidiruv qo'shiladi. Hozircha kod qo'lda yoziladi va formati tekshiriladi.

## 9. Diagnostika va apparatlar
- ✅ Tekshiruv turlari:
  - EKG;
  - ExoKG;
  - UZI;
  - Xolter;
  - SMAD;
  - veloergometriya / yuklama sinovi;
  - boshqa.
- ✅ Har biri uchun tuzilmali maydonlar (EF, KDO', QRS, QT va h.k.) va xulosa.
- ✅ Rasm (JPG, PNG, WebP) yoki PDF biriktirish:
  - fayl turi faylning ichidan tekshiriladi;
  - 10 MB gacha;
  - fleshkadagi fayl ham tanlanadi.
- ✅ Natijalar bemor kartasiga bog'lanadi. Xato natija o'chirilmaydi, "xato" deb belgilanadi.
- ✅ Yangi apparat yoki tekshiruv qo'shish uchun `src/lib/diagnostics.ts`ga bitta yozuv qo'shiladi.
- ⏳ Apparatni kompyuterga to'g'ridan-to'g'ri ulash (EKG va ExoKG'dan avtomatik olish). Buning uchun aniq apparat modeli va uning eksport formati (DICOM, PDF yoki SCP-ECG) kerak.

## 10. Xulosa va hujjatlar
Xulosada:
- ✅ ko'rik, tashxislar, tavsiyalar;
- ✅ dorilar va ularni qabul qilish soatlari jadvali;
- ✅ keyingi tashrif sanasi;
- ✅ shifokor telefoni va Telegrami.

Qo'shimcha:
- ✅ EKG va ExoKG — har biri alohida A4 hujjat.
- ✅ QR kod: bemor portali yoqilgan bo'lsa, natijalarni telefonda ochadi (bemor portalga kirgandan keyin).
- ✅ Hujjatlarda narx chiqmaydi.
- ✅ Hujjatlar o'zbek tilida, lotin yozuvida (klinika tili).
- 🟡 Mavjud klinikalarning "Qabul xulosasi" shablonlariga yangi qatorlar (dori jadvali, keyingi tashrif, aloqa) **Shablonlar** sahifasida qo'lda qo'shiladi. Yangi klinikalarda ular avtomatik bor.

## 11. Rollar va xavfsizlik
- ✅ Admin (klinika egasi), shifokor, registrator, kassir, hamshira va boshqalar. Har kim faqat o'ziga tegishli ma'lumotni ko'radi: masalan registrator tashxisni ko'rmaydi.
- ✅ Muhim harakatlar audit jurnalida saqlanadi.

## 12. Texnik
- ✅ Internetsiz ishlash: lokal Windows ilovasi bitta kompyuterda ishlaydi, boshqa qurilmalar Wi-Fi orqali ulanadi.
- ✅ Har kuni shifrlangan zaxira nusxa olinadi va tiklash tekshiriladi.
- ✅ Hammasi bitta bazada.
- ⏳ **Server bilan oflayn sinxronlash** (internet uzilganda lokalda ishlab, qaytganda serverga birlashtirish) — alohida katta bosqich. Hozircha ikki tanlov bor:
  - lokal ilova — internet kerak emas;
  - server — internet kerak.

  Ikkalasini sinxronlash uchun to'qnashuvlarni hal qilish qoidalari kerak. Shoshilib qilinsa, bemor ma'lumoti yo'qolishi mumkin, shuning uchun alohida loyihalanadi.
