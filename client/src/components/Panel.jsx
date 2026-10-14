export default function Panel({ title, subtitle, actions, children, bodyClass = 'panel-body', className = '', flush = false }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <div>
            {title && <h2 className="t-h2">{title}</h2>}
            {subtitle && <p className="t-small" style={{ marginTop: 2 }}>{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {flush ? children : <div className={bodyClass}>{children}</div>}
    </section>
  );
}
