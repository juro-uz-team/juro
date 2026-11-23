import { LoaderCircle } from "lucide-react";

const labels = { ru: "Продолжить с Google", uz: "Google orqali davom etish", en: "Continue with Google" };
const alternatives = { ru: "или по электронной почте", uz: "yoki email orqali", en: "or use email" };

export function GoogleAuthButton({ locale, onClick, pending }: {
  locale: keyof typeof labels;
  onClick: () => void;
  pending: boolean;
}) {
  return <div className="auth-google">
    <button type="button" className="auth-google-button" onClick={onClick} disabled={pending}>
      {pending ? <LoaderCircle className="auth-spinner" aria-hidden="true" size={20} /> :
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48">
          <path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.67-.35-3.93H24v7.44h11a9.4 9.4 0 0 1-4.08 6.17v5.14h6.61c3.87-3.57 6.08-8.83 6.08-14.82z" />
          <path fill="#34A853" d="M24 44c5.51 0 10.13-1.83 13.53-4.72l-6.61-5.14a12.4 12.4 0 0 1-18.32-6.57H5.78v5.29A20 20 0 0 0 24 44z" />
          <path fill="#FBBC05" d="M12.6 27.57a12 12 0 0 1 0-7.14v-5.29H5.78a20 20 0 0 0 0 17.72l6.82-5.29z" />
          <path fill="#EA4335" d="M24 11.92c3 0 5.69 1.03 7.8 3.05l5.85-5.85A19.2 19.2 0 0 0 24 4 20 20 0 0 0 5.78 15.14l6.82 5.29A12 12 0 0 1 24 11.92z" />
        </svg>}
      {labels[locale]}
    </button>
    <p>{alternatives[locale]}</p>
  </div>;
}
