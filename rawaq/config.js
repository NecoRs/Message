/*
 * إعدادات رواق
 *
 * رفع الصور والفيديوهات يستخدم تخزين Cloudinary السحابي (فيه خطة مجانية).
 * للتفعيل:
 *   1. سوّ حساب مجاني في https://cloudinary.com
 *   2. من Settings ← Upload ← Upload presets اضغط Add upload preset
 *      وخلّ Signing mode = Unsigned، واحفظ.
 *   3. اكتب اسم الحساب (Cloud name) واسم الـpreset تحت.
 */
window.RAWAQ_CONFIG = Object.assign({
  /*
   * توصيل الرسائل والطرف الثاني غير متصل (Firebase Realtime Database، مجاني):
   *   1. ادخل https://console.firebase.google.com وسوّ مشروع جديد.
   *   2. من القائمة: Build ← Realtime Database ← Create Database.
   *   3. من تبويب Rules الصق القواعد الموجودة في README.md واضغط Publish.
   *   4. انسخ رابط القاعدة اللي فوق (ينتهي بـ firebaseio.com أو firebasedatabase.app) وحطه هنا.
   * الرسائل تتشفّر في جهازك قبل ما تنرفع، والسيرفر ما يقدر يقراها.
   */
  db: {
    url: '',           // مثال: 'https://rawaq-1234-default-rtdb.firebaseio.com'
  },
  cloud: {
    cloudName: 'ipz2vzxb',
    uploadPreset: 'ml_default',
  },
}, window.RAWAQ_CONFIG || {});
