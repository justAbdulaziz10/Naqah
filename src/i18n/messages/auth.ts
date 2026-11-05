import { defineMessages } from '../types';

export const auth = defineMessages({
  en: {
    login: 'Owner login', signup: 'Create your account', intro: 'Enter your mobile number. We will send you a code by SMS.',
    accountNote: 'Your number works for login and sign-up.', phone: 'Mobile number', phoneHint: 'Saudi mobile number, for example 05X XXX XXXX.',
    send: 'Send code', sending: 'Sending…', codeTitle: 'Enter the code', code: 'Verification code', codeHint: 'Enter the code from the SMS.',
    sentTo: 'Code sent to', verify: 'Verify and continue', verifying: 'Verifying…', change: 'Change number', resend: 'Send a new code',
    cooldown: (seconds: number) => `Send again in ${seconds} seconds`,
    invalidPhone: 'Enter a valid Saudi mobile number.', invalidCode: 'The code is incorrect or has expired. Try again or request a new code.',
    invalidCodeFormat: 'Enter the code using 6 digits.', rateLimit: 'Too many attempts. Please wait before trying again.',
    network: 'Could not connect. Check your internet and try again.', unavailable: 'Login is unavailable right now. Please try again later.',
    failed: 'Could not complete this step. Please try again later.', signedIn: 'You are signed in',
    successBody: 'Your mobile number is verified. Farm setup and your demo data are separate from your account.',
    logout: 'Log out', loggingOut: 'Logging out…', home: 'Return home', otherLogin: 'Already have an account? Log in', otherSignup: 'New to Naqah? Create an account',
    loading: 'Please wait…', resendSent: 'A new code has been sent.',
  },
  ar: {
    login: 'دخول المالك', signup: 'إنشاء حسابك', intro: 'أدخل رقم جوالك ونرسل لك رمز برسالة نصية.',
    accountNote: 'نفس الرقم للدخول وإنشاء الحساب.', phone: 'رقم الجوال', phoneHint: 'رقم جوال سعودي، مثل 05X XXX XXXX.',
    send: 'إرسال الرمز', sending: 'جاري الإرسال…', codeTitle: 'أدخل الرمز', code: 'رمز التحقق', codeHint: 'أدخل الرمز الموجود في الرسالة النصية.',
    sentTo: 'أرسلنا الرمز إلى', verify: 'تحقق وتابع', verifying: 'جاري التحقق…', change: 'تغيير الرقم', resend: 'إرسال رمز جديد',
    cooldown: (seconds: number) => `تقدر تعيد الإرسال بعد ${seconds} ثانية`,
    invalidPhone: 'أدخل رقم جوال سعودي صحيح.', invalidCode: 'الرمز غير صحيح أو انتهت صلاحيته. حاول مرة ثانية أو اطلب رمز جديد.',
    invalidCodeFormat: 'أدخل الرمز المكوّن من 6 أرقام.', rateLimit: 'المحاولات كثيرة. انتظر شوي وحاول مرة ثانية.',
    network: 'تعذّر الاتصال. تأكد من الإنترنت وحاول مرة ثانية.', unavailable: 'الدخول غير متاح حاليًا. حاول لاحقًا.',
    failed: 'ما قدرنا نكمل هالخطوة. حاول لاحقًا.', signedIn: 'تم تسجيل دخولك',
    successBody: 'تم التحقق من رقم جوالك. إعداد العزبة وبيانات العرض التجريبي منفصلة عن حسابك.',
    logout: 'تسجيل الخروج', loggingOut: 'جاري الخروج…', home: 'العودة للرئيسية', otherLogin: 'عندك حساب؟ سجّل دخولك', otherSignup: 'جديد في ناقة؟ أنشئ حسابك',
    loading: 'لحظة من فضلك…', resendSent: 'أرسلنا لك رمز جديد.',
  },
});
