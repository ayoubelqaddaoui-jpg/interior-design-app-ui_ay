import type { Dict } from './fr';

const dar: Dict = {
  lang: { dar: 'الدارجة المغربية', ar: 'العربية', fr: 'Français' },
  common: {
    save: 'سجّل', cancel: 'إلغاء', delete: 'مسح', edit: 'عدّل', add: 'زيد', close: 'سد', continue: 'كمّل', back: 'رجع', done: 'سالا', try: 'جرّب',
    seeAll: 'شوف الكل', loading: 'كنحمّل…', yes: 'اه', no: 'لا', retry: 'عاود', new: 'جديد', share: 'شارك', copy: 'نسخ', empty: 'والو دابا',
    send: 'صيفط', select: 'اختار', error: 'وقع مشكل', credits: 'كريدي', search: 'قلّب',
  },
  tabs: { home: 'الرئيسية', explore: 'اكتاشف', history: 'التاريخ', assistant: 'المساعد' },
  home: { empty: 'ما كاين حتى أداة فهاد التبويب دابا.' },
  explore: { title: 'اكتاشف', photos: '{{count}} تصويرة', useStyle: 'استعمل هاد الستايل', emptyCat: 'ما كاين حتى تصويرة فهاد القسم.', styleApplied: 'تطبق الستايل' },
  wizard: {
    step: 'الخطوة {{n}}/{{total}}', uploadTitle: 'حمّل تصويرة ديال البيت ديالك دابا', addPhoto: 'زيد تصويرة', camera: 'الكاميرا', gallery: 'الجاليري', selectPhoto: 'اختار تصويرة',
    photoNote: 'استعمل غير الكاميرا ولا الجاليري. الصور ديال التجربة ما كايناش.',
    tipsTitle: 'نصائح للتصويرة', tips: ['صوّر البيت كامل من كوين الحيط', 'ضو مزيان وبلا اهتزاز', 'بعّد الناس والحوايج لي كيتحركو'],
    removePhoto: 'مسح التصويرة', roomTitle: 'اختار نوع البيت', styleTitle: 'اختار ستايل', modeTitle: 'الوضع',
    modeRestyle: 'تبديل الستايل', modeRestyleDesc: 'كيبقى على نفس التقسيم ديال البيت ديالك', modeRenovation: 'تجديد', modeRenovationDesc: 'حرية أكثر باش تعاود تصور البيت',
    palette: 'اختار لوحة ألوان (اختياري)', modelTitle: 'اختار موديل الذكاء الاصطناعي', modelDefault: 'ديفو', generate: 'صاوب', permission: 'عطي الإذن للكاميرا ولا للصور من الإعدادات.',
    noModels: 'ما كاين حتى موديل متاح لهاد الأداة.', pickPhotoFirst: 'زيد تصويرة باش تكمّل.', leave: 'بغيتي تخرج؟', leaveMsg: 'غادي تضيع ليك الخطوات لي دزتي.',
  },
  render: {
    title: 'كنصاوبو ليك التصميم', stages: ['كنحلّلو البيت ديالك…', 'كنختارو الألوان والمواد…', 'كنوزعو الموبيليا…', 'اللمسات الأخيرة والضو…'],
    hint: 'غي ثواني. ما تسدش التطبيق.', cancel: 'إلغاء', failed: 'ما نجحش التصميم. عاود حاول.',
  },
  result: {
    title: 'التصميم ديالك', before: 'قبل', after: 'من بعد', holdHint: 'بقا ضاغط على «قبل» باش تشوف الأصلية', slideHint: 'جرّ باش تقارن', save: 'سجّل', share: 'شارك', regenerate: 'عاود صاوب',
    newDesign: 'تصميم جديد', saved: 'تسجّل فالتاريخ', sharedMsg: 'شوف التصميم لي صاوبت بدويرة', savedGallery: 'تسجلات التصويرة',
    pending: 'غادي نصيفطو ليك التصميم فالواتساب', noCredits: 'سالاو ليك الكريديات. دوز لـ PRO باش تكمّل.',
  },
  lead: {
    title: 'فين نصيفطو ليك التصميم؟', subtitle: 'غادي نصيفطو ليك التصميم ديالك فالواتساب', name: 'سميتك', namePh: 'مثلا: سلمى', whatsapp: 'نمرة الواتساب', whatsappPh: '+212 6 12 34 56 78',
    submit: 'صيفط ليا التصميم', errName: 'كتب سميتك', errPhone: 'كتب نمرة واتساب صحيحة', privacy: 'النمرة ديالك كنستعملوها غير باش نصيفطو ليك التصميم.',
    successTitle: 'توصلنا بالطلب!', successMsg: 'التصميم ديالك غادي يوصلك قريب فالواتساب. خلي التيليفون حدّك.', home: 'رجع للرئيسية', again: 'صاوب تصميم آخر',
  },
  history: {
    title: 'التاريخ', banner: 'حل الإشعارات باش نعلموك ملي التصاميم ديالك يوجدو', designs: 'التصاميم', assistants: 'المحادثات', select: 'اختار', cancel: 'إلغاء', selected: 'مختار {{count}}',
    deleteSel: 'مسح', confirm: 'تمسح العناصر لي اخترتي؟', emptyDesigns: 'مازال ما كاين حتى تصميم', emptyDesignsSub: 'التصاميم ديالك غادي يبانو هنا.', emptyChats: 'ما كاين حتى محادثة', emptyChatsSub: 'هضر مع المساعد وغادي تلقاها هنا.',
    pending: 'كيتسنى الواتساب', start: 'صاوب تصميم', newChat: 'محادثة',
  },
  assistant: {
    hello: 'مرحبا، كيفاش نقدر نعاونك؟', placeholder: 'سول دويرة…', attach: 'زيد تصويرة', thinking: 'دويرة كتكتب…', newChat: 'محادثة جديدة', pro: 'PRO',
    waTitle: 'هضر مع الفريق ديالنا', waDesc: 'مستشار فالديكور كيجاوبك مباشرة فالواتساب.', waOpen: 'حل الواتساب', waDefaultMsg: 'سلام، بغيت مساعدة فتزيين البيت ديالي.',
  },
  settings: {
    title: 'الإعدادات', language: 'اللغة', notifications: 'الإشعارات', notificationsDesc: 'نبهني ملي التصميم يوجد', credits: 'الكريدي', creditsLeft: 'بقاو ليك {{count}}', pro: 'دوز لـ PRO',
    appearance: 'المظهر', about: 'على التطبيق', privacy: 'سياسة الخصوصية', version: 'النسخة', aboutText: 'دويرة كيبدل ليك البيوت بالذكاء الاصطناعي. حمّل تصويرة، اختار ستايل وشوف الديكور الجديد.',
    privacyText: 'الصور ديالك كنستعملوها غير باش نصاوبو ليك التصاميم. نمرة الواتساب كنستعملوها غير باش نصيفطو ليك الخدمة. تقدر تطلب مسح المعطيات ديالك فأي وقت.', admin: 'لوحة الإدارة',
  },
  pro: {
    title: 'دويرة PRO', subtitle: 'صاوب بلا حدود', features: ['تصاميم بلا حدود', 'كل موديلات الذكاء الاصطناعي', 'جودة عالية', 'دعم أولوية فالواتساب'],
    weekly: 'فالسيمانة', monthly: 'فالشهر', yearly: 'فالعام', popular: 'الأكثر طلبا', cta: 'كمّل', restore: 'رجّع المشتريات', demoNote: 'صفحة تجريبية: ما كاين حتى أداء حقيقي.', thanks: 'شكرا! الأداء غادي يتفعّل قريب.',
  },
  notif: { enabled: 'تفعلات الإشعارات', disabled: 'تطفاو الإشعارات' },
  admin: {
    title: 'الإدارة', login: 'دخول الأدمين', email: 'الإيمايل', password: 'الكلمة السرية', signIn: 'دخل', invalid: 'المعلومات غالطة', demoHint: 'تجربة: admin@dwira.app / admin123',
    logout: 'خروج', openApp: 'حل التطبيق', forbidden: 'غير للأدمين', welcome: 'لوحة التحكم', stats: { requests: 'الطلبات', pending: 'كيتسناو', users: 'المستخدمين', tools: 'الأدوات' },
    nav: {
      dashboard: 'لوحة التحكم', branding: 'الهوية', theme: 'الثيم', tabs: 'تبويبات الرئيسية', tools: 'الأدوات', sections: 'سلايدرات الاكتشاف', categories: 'أقسام الاكتشاف', inspirations: 'صور الإلهام',
      styles: 'الستايلات', roomTypes: 'أنواع البيوت', palettes: 'لوحات الألوان', models: 'موديلات الذكاء الاصطناعي', assistant: 'المساعد', credits: 'الكريدي', requests: 'طلبات التصميم', users: 'المستخدمين',
    },
    f: {
      title: 'العنوان', subtitle: 'العنوان الصغير', tab: 'التبويب', media: 'الميديا', mediaType: 'نوع الميديا', image: 'تصويرة', video: 'فيديو', mediaUrl: 'رابط الميديا', poster: 'تصويرة المعاينة (للفيديو)', steps: 'الخطوات المفعلة', models: 'الموديلات المسموحة',
      order: 'الترتيب', visible: 'باين', group: 'المجموعة', displayMode: 'العرض', icon: 'الأيقونة', isNew: 'شريط «جديد»', colors: 'الألوان', isSurprise: 'خيار «فاجئني»', section: 'السلايدر', category: 'القسم', style: 'الستايل',
      provider: 'المزوّد', modelName: 'سمية الموديل', apiKey: 'مفتاح API', enabled: 'مفعّل', isDefault: 'ديفو', name: 'السمية', whatsapp: 'واتساب', credits: 'الكريدي', role: 'الدور', status: 'الحالة', cover: 'الغلاف', roomType: 'نوع البيت', tool: 'الأداة المرتبطة',
      appName: 'سمية التطبيق', logo: 'اللوغو', date: 'التاريخ', photo: 'التصويرة', choices: 'الاختيارات', aiResult: 'نتيجة الذكاء الاصطناعي', finalResult: 'التصميم النهائي', actions: 'إجراءات', uploadImage: 'حمّل تصويرة', title_dar: 'الدارجة', title_ar: 'العربية', title_fr: 'الفرنسية',
    },
    enums: { interior: 'داخلي', exterior: 'خارجي', icon: 'أيقونة', image: 'تصويرة', video: 'فيديو', pending: 'كيتسنى', processing: 'قيد المعالجة', delivered: 'تسلّم', user: 'مستخدم', admin: 'أدمين', room: 'نوع البيت', style: 'الستايل', mode: 'الوضع + الألوان', model: 'اختيار الموديل' },
    crud: { addNew: 'زيد', editItem: 'عدّل', confirmDelete: 'تمسح هاد العنصر؟', noItems: 'ما كاين والو', saved: 'تسجل', up: 'فوق', down: 'تحت', showHide: 'بيّن / خبّي', required: 'خانة ضرورية' },
    brand: { appName: 'سمية التطبيق', logo: 'اللوغو', upload: 'حمّل لوغو', remove: 'مسح', note: 'اللوغو والسمية كيبانو فوق فالصفحة الرئيسية.' },
    theme: { title: 'ثيم التطبيق', light: 'فاتح', dark: 'غامق', royal: 'أزرق ملكي', custom: 'مخصص', preview: 'معاينة مباشرة', colorPrimary: 'اللون الرئيسي', colorBg: 'الخلفية', colorSurface: 'البطايق', colorFg: 'النص', colorInk: 'الأزرار الغامقة', hex: 'كود اللون (#RRGGBB)' },
    assistant: { type: 'نوع المساعد', ai: 'شات ذكاء اصطناعي', whatsapp: 'تواصل فالواتساب', model: 'الموديل', prompt: 'برومبت النظام', number: 'نمرة الواتساب', welcome: 'رسالة الترحيب' },
    credits: { defaultCredits: 'الكريديات المجانية الافتراضية', defaultNote: 'كيتطبق على المستخدمين الجداد.', grant: 'عطي كريدي', user: 'المستخدم', amount: 'شحال من كريدي', grantBtn: 'عطي', granted: 'تزادو الكريديات' },
    req: {
      title: 'طلبات التصميم', autoSend: 'صيفط التصويرة المولّدة أوتوماتيكيا فالواتساب', autoSendNote: 'ملي تفعّلها، التصويرة ديال الذكاء الاصطناعي كتصيفط للعميل ملي كتوجد.', openWa: 'حل الواتساب', uploadFinal: 'حمّل التصميم النهائي',
      markProcessing: 'دير قيد المعالجة', markDelivered: 'دير تسلّم', details: 'تفاصيل الطلب', waMsg: 'سلام {{name}}، هادا هو التصميم ديالك من دويرة!', sentAuto: 'تصيفط أوتوماتيكيا', deliveredToast: 'تحط كتسلّم',
    },
  },
};
export default dar;
