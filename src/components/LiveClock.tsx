import React, { useEffect, useState } from 'react';

interface LiveClockProps {
  mode: 'date' | 'time' | 'datetime';
  format?: 'en-US' | 'en-GB' | 'en-PK';
  showSeconds?: boolean;
  className?: string;
}

/**
 * Isolated clock display that only re-renders itself on tick and pauses when tab is hidden.
 * Prevents full-page POS/Home re-renders every 1 second on mobile devices.
 */
export const LiveClock: React.FC<LiveClockProps> = React.memo(
  ({ mode, format = 'en-US', showSeconds = false, className = '' }) => {
    const [now, setNow] = useState<Date>(() => new Date());

    useEffect(() => {
      const intervalMs = showSeconds ? 1000 : 15000;
      let timer: ReturnType<typeof setInterval> | null = null;

      const startTimer = () => {
        if (timer) return;
        timer = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') {
            setNow(new Date());
          }
        }, intervalMs);
      };

      const stopTimer = () => {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      };

      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          setNow(new Date());
          startTimer();
        } else {
          stopTimer();
        }
      };

      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        startTimer();
      }
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibilityChange);
      }

      return () => {
        stopTimer();
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onVisibilityChange);
        }
      };
    }, [showSeconds]);

    let text = '';
    if (mode === 'date') {
      if (format === 'en-GB') {
        const d = now.getDate().toString().padStart(2, '0');
        const m = (now.getMonth() + 1).toString().padStart(2, '0');
        const y = now.getFullYear();
        text = `${d}/${m}/${y}`;
      } else {
        text = now.toLocaleDateString('en-PK', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
      }
    } else if (mode === 'time') {
      text = now.toLocaleTimeString(format === 'en-GB' ? 'en-US' : format, {
        hour: '2-digit',
        minute: '2-digit',
        ...(showSeconds ? { second: '2-digit' } : {}),
        hour12: true,
      });
    } else {
      text = `${now.toLocaleDateString('en-PK', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })} • ${now.toLocaleTimeString('en-PK', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })}`;
    }

    return <span className={className}>{text}</span>;
  }
);

LiveClock.displayName = 'LiveClock';
