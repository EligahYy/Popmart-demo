export function Flower({
  className,
  petal = '#f6b7c6',
  center = '#f2d178',
}: {
  className?: string;
  petal?: string;
  center?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 60 60" aria-hidden="true">
      {[0, 72, 144, 216, 288].map((angle) => (
        <ellipse
          key={angle}
          cx="30"
          cy="12"
          rx="10"
          ry="12"
          fill={petal}
          stroke="rgba(120, 70, 80, 0.18)"
          strokeWidth="1"
          transform={`rotate(${angle} 30 30)`}
        />
      ))}
      <circle cx="30" cy="30" r="8" fill={center} stroke="rgba(120, 70, 80, 0.2)" strokeWidth="1" />
    </svg>
  );
}

export function Cloud({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 70" aria-hidden="true">
      <ellipse cx="35" cy="45" rx="26" ry="20" fill="#fffdfa" opacity="0.92" />
      <ellipse cx="60" cy="34" rx="30" ry="24" fill="#fffdfa" opacity="0.95" />
      <ellipse cx="90" cy="46" rx="24" ry="18" fill="#fffdfa" opacity="0.9" />
      <rect x="18" y="45" width="84" height="18" rx="9" fill="#fffdfa" opacity="0.95" />
    </svg>
  );
}

import twinkle from '../../assets/ips/twinkle.png';
import crybaby from '../../assets/ips/crybaby.png';
import nyota from '../../assets/ips/nyota.png';
import zsiga from '../../assets/ips/zsiga.png';
import dimoo from '../../assets/ips/dimoo.png';
import hirono from '../../assets/ips/hirono.png';
import shelfImage from '../../assets/shelf3d.png';

const IPS = [
  { key: 'twinkle', src: twinkle },
  { key: 'crybaby', src: crybaby },
  { key: 'nyota', src: nyota },
  { key: 'zsiga', src: zsiga },
  { key: 'dimoo', src: dimoo },
  { key: 'hirono', src: hirono },
];

/** 用户提供的 3D 收纳架 + 六个 IP 抠图，站在两层隔板上 */
export function Shelf({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <div className="shelf-photo">
        <img className="shelf-photo__body" src={shelfImage} alt="" draggable={false} />
        <div className="shelf-photo__row shelf-photo__row--top">
          {IPS.slice(0, 3).map((ip) => (
            <span key={ip.key} className="shelf-photo__slot">
              <img className="shelf-photo__ip" src={ip.src} alt="" draggable={false} />
            </span>
          ))}
        </div>
        <div className="shelf-photo__row shelf-photo__row--bottom">
          {IPS.slice(3).map((ip) => (
            <span key={ip.key} className="shelf-photo__slot">
              <img className="shelf-photo__ip" src={ip.src} alt="" draggable={false} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
