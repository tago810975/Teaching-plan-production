export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="banner" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onDismiss}>
        知道了
      </button>
    </div>
  )
}
