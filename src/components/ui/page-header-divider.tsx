export function PageHeaderDivider() {
  return (
    <div 
      className="h-px w-full mt-0.5" 
      style={{ 
        background: 'linear-gradient(to right, transparent, hsl(var(--border)), transparent)' 
      }} 
    />
  );
}
