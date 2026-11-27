import { UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { lawyerText } from "../../lib/platform/lawyer-localization";
import { platformPath, type PlatformLocale } from "../../lib/platform/routing";
import { praeLegalFirm, praeLegalRequestLabel, type praeLegalDirectoryProfiles } from "./prae-legal-directory";
import { WorkspaceTitle } from "./WorkspaceTitle";

export function PraeLegalDirectoryProfile({ locale, profile }: {
  locale: PlatformLocale;
  profile: ReturnType<typeof praeLegalDirectoryProfiles>[number];
}) {
  const text = (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english);

  return <section className="platform-module lawyer-public-profile workspace-page">
    <WorkspaceTitle
      icon={<UserRound />}
      title={profile.displayName}
      actions={<Link className="lawyer-directory-link" href={platformPath(locale, "individual", "lawyers")}>
        {text("К каталогу", "Katalogga qaytish", "Back to directory")}
      </Link>}
    />
    <div className="lawyer-public-profile-hero">
      <div className="lawyer-public-photo">
        <Image src={profile.profilePhotoUrl} alt="" width={144} height={144} unoptimized />
      </div>
      <div className="lawyer-public-identity">
        <h2>{profile.role}</h2>
        <p>{praeLegalFirm}</p>
      </div>
      <aside className="lawyer-public-booking">
        <button type="button" className="lawyer-directory-request" disabled>{praeLegalRequestLabel[locale]}</button>
      </aside>
    </div>
    <div className="lawyer-public-profile-grid">
      <section>
        <h2>{text("О специалисте", "Mutaxassis haqida", "About the professional")}</h2>
        <p>{profile.bio}</p>
      </section>
      <section>
        <h2>{text("Специализации", "Mutaxassisliklar", "Practice areas")}</h2>
        <p>{profile.specialties.join(" · ")}</p>
      </section>
    </div>
  </section>;
}
