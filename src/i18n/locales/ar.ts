import type { Dict } from './fr';

const ar: Dict = {
  lang: { dar: 'الدارجة المغربية', ar: 'العربية', fr: 'Français' },
  common: {
    save: 'حفظ', cancel: 'إلغاء', delete: 'حذف', edit: 'تعديل', add: 'إضافة', close: 'إغلاق', continue: 'متابعة', back: 'رجوع', done: 'تم', try: 'جرّب',
    seeAll: 'عرض الكل', loading: 'جارٍ التحميل…', yes: 'نعم', no: 'لا', retry: 'إعادة المحاولة', new: 'جديد', share: 'مشاركة', copy: 'نسخ', empty: 'لا يوجد شيء للعرض حاليًا',
    send: 'إرسال', select: 'تحديد', error: 'حدث خطأ ما', credits: 'رصيد', search: 'بحث',
  },
  tabs: { home: 'الرئيسية', explore: 'استكشاف', history: 'السجل', assistant: 'المساعد' },
  home: { empty: 'لا توجد أدوات في هذا التبويب حاليًا.' },
  explore: { title: 'استكشاف', photos: '{{count}} صورة', useStyle: 'استخدم هذا الأسلوب', emptyCat: 'لا توجد صور في هذه الفئة.', styleApplied: 'تم تطبيق الأسلوب' },
  wizard: {
    step: 'الخطوة {{n}}/{{total}}', uploadTitle: 'ارفع صورة لغرفتك الحالية', addPhoto: 'إضافة صورة', camera: 'الكاميرا', gallery: 'المعرض', selectPhoto: 'اختر صورة',
    photoNote: 'استخدم الكاميرا أو المعرض فقط. الصور التجريبية غير متاحة.',
    tipsTitle: 'نصائح للتصوير', tips: ['صوّر الغرفة كاملة من زاوية الجدار', 'إضاءة جيدة وبدون اهتزاز', 'تجنّب الأشخاص والأشياء المتحركة'],
    removePhoto: 'إزالة الصورة', roomTitle: 'اختر نوع الغرفة', styleTitle: 'اختر أسلوبًا', modeTitle: 'الوضع',
    modeRestyle: 'تغيير الأسلوب', modeRestyleDesc: 'يحافظ على تخطيط غرفتك الحالي', modeRenovation: 'تجديد', modeRenovationDesc: 'حرية أكبر لإعادة تصور الغرفة',
    palette: 'اختر لوحة ألوان (اختياري)', modelTitle: 'اختر نموذج الذكاء الاصطناعي', modelDefault: 'افتراضي', generate: 'إنشاء', permission: 'اسمح بالوصول إلى الكاميرا أو الصور من الإعدادات.',
    noModels: 'لا توجد نماذج متاحة لهذه الأداة.', pickPhotoFirst: 'أضف صورة للمتابعة.', leave: 'مغادرة المعالج؟', leaveMsg: 'سيتم فقدان تقدمك.',
  },
  render: {
    title: 'جارٍ الإنشاء', stages: ['تحليل غرفتك…', 'اختيار المواد والألوان…', 'توزيع الأثاث…', 'اللمسات الأخيرة والإضاءة…'],
    hint: 'يستغرق الأمر بضع ثوانٍ. لا تغلق التطبيق.', cancel: 'إلغاء', failed: 'فشل الإنشاء. حاول مجددًا.',
  },
  result: {
    title: 'تصميمك', before: 'قبل', after: 'بعد', holdHint: 'اضغط مطولًا على «قبل» لرؤية الأصل', slideHint: 'اسحب للمقارنة', save: 'حفظ', share: 'مشاركة', regenerate: 'إعادة الإنشاء',
    newDesign: 'تصميم جديد', saved: 'تم الحفظ في السجل', sharedMsg: 'شاهد تصميمي الذي أنشأته بواسطة دويرة', savedGallery: 'تم حفظ الصورة',
    pending: 'سيتم إرسال تصميمك عبر واتساب', noCredits: 'نفد رصيدك. اشترك في PRO للمتابعة.',
  },
  lead: {
    title: 'أين نرسل تصميمك؟', subtitle: 'سنرسل تصميمك إلى واتساب الخاص بك', name: 'اسمك', namePh: 'مثال: سلمى', whatsapp: 'رقم واتساب', whatsappPh: '+212 6 12 34 56 78',
    submit: 'أرسل تصميمي', errName: 'أدخل اسمك', errPhone: 'أدخل رقم واتساب صحيحًا', privacy: 'يُستخدم رقمك فقط لإرسال تصميمك.',
    successTitle: 'تم إرسال الطلب!', successMsg: 'سيصلك تصميمك قريبًا على واتساب. أبقِ هاتفك قريبًا منك.', home: 'العودة إلى الرئيسية', again: 'إنشاء تصميم آخر',
  },
  history: {
    title: 'السجل', banner: 'فعّل الإشعارات لتعرف عندما تصبح تصاميمك جاهزة', designs: 'التصاميم', assistants: 'المحادثات', select: 'تحديد', cancel: 'إلغاء', selected: 'تم تحديد {{count}}',
    deleteSel: 'حذف', confirm: 'حذف العناصر المحددة؟', emptyDesigns: 'لا توجد تصاميم بعد', emptyDesignsSub: 'ستظهر إبداعاتك هنا.', emptyChats: 'لا توجد محادثات', emptyChatsSub: 'تحدث مع المساعد لتجدها هنا.',
    pending: 'بانتظار واتساب', start: 'إنشاء تصميم', newChat: 'محادثة',
  },
  assistant: {
    hello: 'مرحبًا، كيف يمكنني مساعدتك؟', placeholder: 'اسأل دويرة…', attach: 'إرفاق صورة', thinking: 'دويرة تكتب…', newChat: 'محادثة جديدة', pro: 'PRO',
    waTitle: 'تحدث مع فريقنا', waDesc: 'مستشار ديكور يجيبك مباشرة عبر واتساب.', waOpen: 'فتح واتساب', waDefaultMsg: 'مرحبًا، أحتاج مساعدة في تزيين غرفتي.',
  },
  settings: {
    title: 'الإعدادات', language: 'اللغة', notifications: 'الإشعارات', notificationsDesc: 'تنبيهي عندما يصبح التصميم جاهزًا', credits: 'الرصيد', creditsLeft: 'المتبقي: {{count}}', pro: 'الترقية إلى PRO',
    appearance: 'المظهر', about: 'حول التطبيق', privacy: 'سياسة الخصوصية', version: 'الإصدار', aboutText: 'دويرة يحوّل غرفك بالذكاء الاصطناعي. ارفع صورة، اختر أسلوبًا واكتشف ديكورك الجديد.',
    privacyText: 'تُستخدم صورك فقط لإنشاء تصاميمك. يُستخدم رقم واتساب فقط لإرسال إبداعاتك. يمكنك طلب حذف بياناتك في أي وقت.', admin: 'لوحة الإدارة',
  },
  pro: {
    title: 'دويرة PRO', subtitle: 'أنشئ بلا حدود', features: ['تصاميم غير محدودة', 'جميع نماذج الذكاء الاصطناعي', 'نتائج عالية الدقة', 'دعم ذو أولوية عبر واتساب'],
    weekly: 'أسبوعي', monthly: 'شهري', yearly: 'سنوي', popular: 'الأكثر طلبًا', cta: 'متابعة', restore: 'استعادة المشتريات', demoNote: 'صفحة تجريبية: لا يوجد دفع حقيقي.', thanks: 'شكرًا! سيتم تفعيل الدفع قريبًا.',
  },
  notif: { enabled: 'تم تفعيل الإشعارات', disabled: 'تم إيقاف الإشعارات' },
  admin: {
    title: 'الإدارة', login: 'دخول المشرف', email: 'البريد الإلكتروني', password: 'كلمة المرور', signIn: 'تسجيل الدخول', invalid: 'بيانات غير صحيحة', demoHint: 'تجريبي: admin@dwira.app / admin123',
    logout: 'تسجيل الخروج', openApp: 'فتح التطبيق', forbidden: 'الدخول للمشرفين فقط', welcome: 'لوحة التحكم', stats: { requests: 'الطلبات', pending: 'قيد الانتظار', users: 'المستخدمون', tools: 'الأدوات' },
    nav: {
      dashboard: 'لوحة التحكم', branding: 'الهوية', theme: 'السمة', tabs: 'تبويبات الرئيسية', tools: 'الأدوات', sections: 'شرائح الاستكشاف', categories: 'فئات الاستكشاف', inspirations: 'صور الإلهام',
      styles: 'الأساليب', roomTypes: 'أنواع الغرف', palettes: 'لوحات الألوان', models: 'نماذج الذكاء الاصطناعي', assistant: 'المساعد', credits: 'الرصيد', requests: 'طلبات التصميم', users: 'المستخدمون',
    },
    f: {
      title: 'العنوان', subtitle: 'العنوان الفرعي', tab: 'التبويب', media: 'الوسائط', mediaType: 'نوع الوسائط', image: 'صورة', video: 'فيديو', mediaUrl: 'رابط الوسائط', poster: 'صورة المعاينة (للفيديو)', steps: 'الخطوات المفعّلة', models: 'النماذج المسموحة',
      order: 'الترتيب', visible: 'ظاهر', group: 'المجموعة', displayMode: 'العرض', icon: 'الأيقونة', isNew: 'شريط «جديد»', colors: 'الألوان', isSurprise: 'خيار «فاجئني»', section: 'الشريحة', category: 'الفئة', style: 'الأسلوب',
      provider: 'المزوّد', modelName: 'اسم النموذج', apiKey: 'مفتاح API', enabled: 'مفعّل', isDefault: 'افتراضي', name: 'الاسم', whatsapp: 'واتساب', credits: 'الرصيد', role: 'الدور', status: 'الحالة', cover: 'الغلاف', roomType: 'نوع الغرفة', tool: 'الأداة المرتبطة',
      appName: 'اسم التطبيق', logo: 'الشعار', date: 'التاريخ', photo: 'الصورة', choices: 'الاختيارات', aiResult: 'نتيجة الذكاء الاصطناعي', finalResult: 'التصميم النهائي', actions: 'إجراءات', uploadImage: 'رفع صورة', title_dar: 'الدارجة', title_ar: 'العربية', title_fr: 'الفرنسية',
    },
    enums: { interior: 'داخلي', exterior: 'خارجي', icon: 'أيقونة', image: 'صورة', video: 'فيديو', pending: 'قيد الانتظار', processing: 'قيد المعالجة', delivered: 'تم التسليم', user: 'مستخدم', admin: 'مشرف', room: 'نوع الغرفة', style: 'الأسلوب', mode: 'الوضع + الألوان', model: 'اختيار النموذج' },
    crud: { addNew: 'إضافة', editItem: 'تعديل', confirmDelete: 'حذف هذا العنصر؟', noItems: 'لا توجد عناصر', saved: 'تم الحفظ', up: 'للأعلى', down: 'للأسفل', showHide: 'إظهار / إخفاء', required: 'حقل مطلوب' },
    brand: { appName: 'اسم التطبيق', logo: 'الشعار', upload: 'رفع شعار', remove: 'إزالة', note: 'يظهر الشعار والاسم أعلى الصفحة الرئيسية.' },
    theme: { title: 'سمة التطبيق', light: 'فاتح', dark: 'داكن', royal: 'أزرق ملكي', custom: 'مخصص', preview: 'معاينة مباشرة', colorPrimary: 'اللون الرئيسي', colorBg: 'الخلفية', colorSurface: 'البطاقات', colorFg: 'النص', colorInk: 'الأزرار الداكنة', hex: 'رمز اللون (#RRGGBB)' },
    assistant: { type: 'نوع المساعد', ai: 'دردشة ذكاء اصطناعي', whatsapp: 'تواصل عبر واتساب', model: 'النموذج', prompt: 'تعليمات النظام', number: 'رقم واتساب', welcome: 'رسالة الترحيب' },
    credits: { defaultCredits: 'الرصيد المجاني الافتراضي', defaultNote: 'يُطبّق على المستخدمين الجدد.', grant: 'منح رصيد', user: 'المستخدم', amount: 'عدد النقاط', grantBtn: 'منح', granted: 'تمت إضافة الرصيد' },
    req: {
      title: 'طلبات التصميم', autoSend: 'إرسال الصورة المولّدة تلقائيًا إلى واتساب', autoSendNote: 'عند التفعيل تُرسل صورة الذكاء الاصطناعي للعميل فور إنشائها.', openWa: 'فتح واتساب', uploadFinal: 'رفع التصميم النهائي',
      markProcessing: 'تحديد كقيد المعالجة', markDelivered: 'تحديد كمُسلَّم', details: 'تفاصيل الطلب', waMsg: 'مرحبًا {{name}}، هذا تصميمك من دويرة!', sentAuto: 'تم الإرسال تلقائيًا', deliveredToast: 'تم التحديد كمُسلَّم',
    },
  },
};
export default ar;
