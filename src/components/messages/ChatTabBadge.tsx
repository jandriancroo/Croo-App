import { motion, AnimatePresence } from 'framer-motion';

interface ChatTabBadgeProps {
  count: number;
  className?: string;
}

export function ChatTabBadge({ count, className = '' }: ChatTabBadgeProps) {
  if (count === 0) return null;

  return (
    <AnimatePresence>
      <motion.span
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
        className={`
          absolute -top-1 -right-1 
          min-w-[18px] h-[18px] 
          flex items-center justify-center 
          text-[10px] font-bold 
          bg-destructive text-destructive-foreground 
          rounded-full px-1
          ${className}
        `}
      >
        {count > 99 ? '99+' : count}
      </motion.span>
    </AnimatePresence>
  );
}
