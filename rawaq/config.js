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
  cloud: {
    cloudName: 'ipz2vzxb',
    uploadPreset: '',  // مثال: 'rawaq_unsigned'
  },
}, window.RAWAQ_CONFIG || {});
