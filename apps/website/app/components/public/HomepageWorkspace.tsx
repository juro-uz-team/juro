import { ArrowDownRight, ArrowUpRight, Archive, Bell, BriefcaseBusiness, CalendarDays, ChevronDown, Clock, FileText, LayoutGrid, Mail, MessageSquareText, Search, UsersRound } from "lucide-react";
import { workspaceCopy } from "../../../content/homepage-workspace";
import type { PublicLanguage } from "../../../content/types";
import { platformAccountHref, platformPersonalHref } from "./platform-hrefs";
import styles from "./juro-home.module.css";
import workspace from "./homepage-workspace.module.css";

const tools = [
  { id: "monitoring", icon: Bell },
  { id: "calendar", icon: CalendarDays },
  { id: "search", icon: Search },
  { id: "team", icon: UsersRound },
] as const;
const resultIcons = [MessageSquareText, BriefcaseBusiness, FileText];

export function HomepageWorkspace({ language }: { language: PublicLanguage }) {
  const copy = workspaceCopy[language];
  const { monitoring, calendar, search, team } = copy;
  const paths = {
    monitoring: platformPersonalHref(language, "/monitoring"),
    calendar: platformPersonalHref(language, "/calendar"),
    search: platformPersonalHref(language, "/dashboard"),
    team: platformAccountHref(language, "business", "/dashboard"),
  };
  const source = language === "ru" ? "https://lex.uz/ru/docs/6257461" : "https://lex.uz/uz/acts/-6257345";
  const previews = {
    monitoring: (
      <details className={workspace.monitoring}>
        <summary>
          <span className={workspace.previewIcon}><Bell size={20} aria-hidden="true" /></span>
          {monitoring.inspect}<ChevronDown size={17} aria-hidden="true" />
        </summary>
        <div className={workspace.record}>
          <small>Lex.uz · {monitoring.identifier} · <time dateTime="2022-10-28">{monitoring.date}</time></small>
          <strong>{monitoring.act}</strong>
          <a className={styles.textLink} href={source}>{monitoring.source}<ArrowUpRight size={15} aria-hidden="true" /></a>
        </div>
      </details>
    ),
    calendar: (
      <details className={workspace.calendar}>
        <summary>
          <span className={workspace.visuallyHidden}>{calendar.day}</span>
          <span className={workspace.month} aria-hidden="true"><CalendarDays size={17} />{calendar.month}</span>
          <span className={workspace.days} aria-hidden="true">
            <span>16</span><span>17</span><strong>18<ChevronDown size={14} /></strong><span>19</span><span>20</span>
          </span>
        </summary>
        <div className={workspace.dateTask}>
          <span className={workspace.previewIcon}><Clock size={17} aria-hidden="true" /></span>
          <div><strong>{calendar.task}</strong><small>{calendar.matter}</small></div>
        </div>
      </details>
    ),
    search: (
      <details className={workspace.search}>
        <summary><Search size={20} aria-hidden="true" />{search.query}<ChevronDown size={17} aria-hidden="true" /></summary>
        <ul className={workspace.results}>
          {search.results.map(([type, title], index) => {
            const Icon = resultIcons[index];
            return <li key={type}><Icon size={17} aria-hidden="true" /><small>{type}</small><strong>{title}</strong></li>;
          })}
        </ul>
      </details>
    ),
    team: (
      <details className={workspace.team}>
        <summary><span className={workspace.previewIcon}><UsersRound size={20} aria-hidden="true" /></span>{team.preview}<ChevronDown size={17} aria-hidden="true" /></summary>
        <div className={workspace.invitation}><Mail size={19} aria-hidden="true" /><strong>{team.viewer}</strong><span>{team.pending}</span></div>
      </details>
    ),
  };

  return (
    <section className={`${styles.wrap} ${workspace.section}`} id="workspace-tools" aria-labelledby="workspace-tools-title">
      <div className={workspace.stage}>
        <div className={`${styles.sectionCopy} ${workspace.heading}`}>
          <h2 id="workspace-tools-title">{copy.title}</h2>
          <p>{copy.intro}</p>
        </div>
        <fieldset className={workspace.choices}>
          <legend className={workspace.visuallyHidden}>{copy.choose}</legend>
          {tools.map(({ id, icon: Icon }, index) => (
            <label key={id}>
              <input className={workspace.visuallyHidden} type="radio" name="homepage-workspace" value={id} defaultChecked={index === 0} aria-controls={`workspace-example-${id}`} />
              <Icon size={18} aria-hidden="true" /><span>{copy[id].label}</span><ArrowDownRight size={16} aria-hidden="true" />
            </label>
          ))}
        </fieldset>
        <div className={workspace.previews} data-home-reveal>
          {tools.map(({ id }) => (
            <article className={workspace.panel} data-example={id} id={`workspace-example-${id}`} aria-labelledby={`workspace-title-${id}`} key={id}>
              <p className={workspace.sample}><LayoutGrid size={13} aria-hidden="true" />{copy.sample}</p>
              <h3 id={`workspace-title-${id}`}>{copy[id].title}</h3>
              <p className={workspace.hint}>{copy[id].hint}</p>
              {previews[id]}
              <a className={styles.textLink} href={paths[id]} aria-label={`${copy.open} · ${copy[id].label}`}>{copy.open}<ArrowUpRight size={15} aria-hidden="true" /></a>
            </article>
          ))}
        </div>
        <details className={workspace.more}>
          <summary>{copy.more}<ChevronDown size={16} aria-hidden="true" /></summary>
          <div className={workspace.moreLinks}>
            <div>
              <strong>{copy.individual}</strong>
              <a href={platformPersonalHref(language, "/history")}><Clock size={16} aria-hidden="true" />{copy.history}</a>
              <a href={platformPersonalHref(language, "/archive")}><Archive size={16} aria-hidden="true" />{copy.archive}</a>
            </div>
            <div>
              <strong>{copy.lawyer}</strong>
              <a href={platformAccountHref(language, "lawyer", "/consultations?view=requests")}><Bell size={16} aria-hidden="true" />{copy.requests}</a>
              <a href={platformAccountHref(language, "lawyer", "/consultations?view=schedule")}><CalendarDays size={16} aria-hidden="true" />{copy.schedule}</a>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}
