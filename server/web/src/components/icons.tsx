import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(children: ReactNode, displayName: string) {
  const Icon = ({ size = 18, strokeWidth = 1.6, ...rest }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
  Icon.displayName = displayName;
  return Icon;
}

export const IconLive = make(
  <>
    <rect x="3" y="4" width="8" height="7" rx="1.5" />
    <rect x="13" y="4" width="8" height="7" rx="1.5" />
    <rect x="3" y="13" width="8" height="7" rx="1.5" />
    <rect x="13" y="13" width="8" height="7" rx="1.5" />
  </>,
  'IconLive',
);
export const IconRecordings = make(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M10 9.5v5l4.5-2.5z" />
  </>,
  'IconRecordings',
);
export const IconEvents = make(<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />, 'IconEvents');
export const IconCamera = make(
  <>
    <path d="M3.5 7.5 16 4l1.6 5.2L5.1 12.7z" />
    <path d="m17.6 9.2 2.9-.9" />
    <path d="M9 11.5 10 15" />
    <path d="M4 18h6v-3H8" />
    <path d="M4 15.5V20" />
  </>,
  'IconCamera',
);
export const IconStorage = make(
  <>
    <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
    <path d="M4.5 6v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6" />
    <path d="M4.5 12v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6" />
  </>,
  'IconStorage',
);
export const IconGateway = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17" />
    <path d="M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z" />
  </>,
  'IconGateway',
);
export const IconUsers = make(
  <>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8" />
    <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8" />
    <path d="M17.4 14.6c1.6.6 2.7 2.1 3.1 4.4" />
  </>,
  'IconUsers',
);
export const IconSettings = make(
  <>
    <path d="M4 7h9" />
    <path d="M17 7h3" />
    <circle cx="15" cy="7" r="2" />
    <path d="M4 17h3" />
    <path d="M11 17h9" />
    <circle cx="9" cy="17" r="2" />
  </>,
  'IconSettings',
);
export const IconSystem = make(
  <>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
  </>,
  'IconSystem',
);
export const IconPhone = make(
  <>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M10.5 18.5h3" />
  </>,
  'IconPhone',
);
export const IconQr = make(
  <>
    <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
    <rect x="14.5" y="3.5" width="6" height="6" rx="1" />
    <rect x="3.5" y="14.5" width="6" height="6" rx="1" />
    <path d="M14.5 14.5h2.5v2.5M20.5 14.5v0M14.5 20.5h2.5M20.5 18v2.5h-1" />
  </>,
  'IconQr',
);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />, 'IconPlus');
export const IconClose = make(<path d="M6 6l12 12M18 6 6 18" />, 'IconClose');
export const IconCheck = make(<path d="m5 12.5 4.5 4.5L19 7.5" />, 'IconCheck');
export const IconChevronLeft = make(<path d="m14.5 6-6 6 6 6" />, 'IconChevronLeft');
export const IconChevronRight = make(<path d="m9.5 6 6 6-6 6" />, 'IconChevronRight');
export const IconChevronDown = make(<path d="m6 9.5 6 6 6-6" />, 'IconChevronDown');
export const IconChevronUp = make(<path d="m6 14.5 6-6 6 6" />, 'IconChevronUp');
export const IconArrowUp = make(<path d="M12 19V5M6 11l6-6 6 6" />, 'IconArrowUp');
export const IconArrowDown = make(<path d="M12 5v14M6 13l6 6 6-6" />, 'IconArrowDown');
export const IconTrash = make(
  <>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V4.5h5V7" />
    <path d="M6.5 7l.8 12.2c.1 1 .9 1.8 1.9 1.8h5.6c1 0 1.8-.8 1.9-1.8L17.5 7" />
  </>,
  'IconTrash',
);
export const IconEdit = make(
  <>
    <path d="M14.5 5.5 18.5 9.5" />
    <path d="M4 20l1-4.5L15.8 4.7a1.9 1.9 0 0 1 2.7 0l.8.8a1.9 1.9 0 0 1 0 2.7L8.5 19z" />
  </>,
  'IconEdit',
);
export const IconCopy = make(
  <>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
    <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
  </>,
  'IconCopy',
);
export const IconDownload = make(
  <>
    <path d="M12 4v11M7 10.5l5 5 5-5" />
    <path d="M4.5 19.5h15" />
  </>,
  'IconDownload',
);
export const IconRefresh = make(
  <>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4h-4" />
  </>,
  'IconRefresh',
);
export const IconRadar = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 12 18 6" />
    <circle cx="12" cy="12" r=".8" fill="currentColor" />
  </>,
  'IconRadar',
);
export const IconLogout = make(
  <>
    <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14" />
    <path d="M10 8 6 12l4 4M6 12h9" />
  </>,
  'IconLogout',
);
export const IconUser = make(
  <>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 19.5c.8-3.3 3.6-5.3 7-5.3s6.2 2 7 5.3" />
  </>,
  'IconUser',
);
export const IconPlay = make(<path d="M8 5.5v13l10.5-6.5z" />, 'IconPlay');
export const IconExpand = make(<path d="M14.5 4.5h5v5M9.5 19.5h-5v-5M19.5 4.5 14 10M4.5 19.5 10 14" />, 'IconExpand');
export const IconZoomIn = make(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4M11 8.5v5M8.5 11h5" />
  </>,
  'IconZoomIn',
);
export const IconZoomOut = make(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4M8.5 11h5" />
  </>,
  'IconZoomOut',
);
export const IconClock = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
  'IconClock',
);
export const IconAlert = make(
  <>
    <path d="M12 4 2.8 19.5h18.4z" />
    <path d="M12 10v4.5M12 17.2v.1" />
  </>,
  'IconAlert',
);
export const IconCloud = make(
  <path d="M7 18.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.6a4.5 4.5 0 0 1-.5 8.9z" />,
  'IconCloud',
);
export const IconFolder = make(<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />, 'IconFolder');
export const IconLink = make(
  <>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </>,
  'IconLink',
);
export const IconUnlink = make(
  <>
    <path d="M15.5 13.5 18.7 10.3a4 4 0 0 0-5.7-5.7L10.5 7" />
    <path d="M8.5 10.5 5.3 13.7a4 4 0 0 0 5.7 5.7l2.5-2.4" />
    <path d="M4 4l16 16" />
  </>,
  'IconUnlink',
);
export const IconGrip = make(
  <>
    <circle cx="9" cy="6.5" r=".9" fill="currentColor" />
    <circle cx="15" cy="6.5" r=".9" fill="currentColor" />
    <circle cx="9" cy="12" r=".9" fill="currentColor" />
    <circle cx="15" cy="12" r=".9" fill="currentColor" />
    <circle cx="9" cy="17.5" r=".9" fill="currentColor" />
    <circle cx="15" cy="17.5" r=".9" fill="currentColor" />
  </>,
  'IconGrip',
);
export const IconList = make(<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11M4.5 6.5h0M4.5 12h0M4.5 17.5h0" />, 'IconList');
export const IconTimeline = make(
  <>
    <path d="M3.5 12h17" />
    <rect x="5" y="9" width="5" height="6" rx="1" />
    <rect x="13" y="9" width="4" height="6" rx="1" />
  </>,
  'IconTimeline',
);
export const IconSnapshot = make(
  <>
    <path d="M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="12.5" r="3.5" />
  </>,
  'IconSnapshot',
);
export const IconOffline = make(
  <>
    <path d="M2.5 9a14 14 0 0 1 4.2-2.6M10 5.6A14 14 0 0 1 21.5 9" />
    <path d="M5.5 12.5a9.5 9.5 0 0 1 3.4-2M13.5 10.4a9.5 9.5 0 0 1 5 2.1" />
    <path d="M9 16a4.5 4.5 0 0 1 6 0" />
    <path d="M12 19.5h0" />
    <path d="M3 3l18 18" />
  </>,
  'IconOffline',
);
export const IconShield = make(
  <>
    <path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </>,
  'IconShield',
);
export const IconExternal = make(
  <>
    <path d="M14 4.5h5.5V10M19.5 4.5 11 13" />
    <path d="M18 14v4a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V8a1.5 1.5 0 0 1 1.5-1.5h4" />
  </>,
  'IconExternal',
);
export const IconMore = make(
  <>
    <circle cx="6" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="18" cy="12" r="1" fill="currentColor" />
  </>,
  'IconMore',
);
export const IconKey = make(
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2" />
  </>,
  'IconKey',
);
export const IconServer = make(
  <>
    <rect x="3.5" y="4" width="17" height="7" rx="1.8" />
    <rect x="3.5" y="13" width="17" height="7" rx="1.8" />
    <path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6" />
  </>,
  'IconServer',
);
export const IconMotion = make(
  <>
    <circle cx="12" cy="12" r="2.5" />
    <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8" />
  </>,
  'IconMotion',
);
