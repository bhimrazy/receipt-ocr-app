/** A settings group: heading and description on the left at desktop width, content on the right. */
export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="grid gap-4 border-t border-border py-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10"
    >
      <div>
        <h2 className="text-base font-semibold" id={id}>
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
