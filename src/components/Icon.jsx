function Icon({ name }) {
  const common = { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24' };
  switch (name) {
    case 'prev':
      return (
        <svg {...common}>
          <polygon points="19 20 9 12 19 4 19 20"></polygon>
          <line x1="5" y1="19" x2="5" y2="5"></line>
        </svg>
      );
    case 'next':
      return (
        <svg {...common}>
          <polygon points="5 4 15 12 5 20 5 4"></polygon>
          <line x1="19" y1="5" x2="19" y2="19"></line>
        </svg>
      );
    case 'play':
      return (
        <svg {...common}>
          <polygon points="6 3 20 12 6 21 6 3"></polygon>
        </svg>
      );
    case 'pause':
      return (
        <svg {...common}>
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
      );
    case 'repeat':
      return (
        <svg {...common}>
          <polyline points="17 1 21 5 17 9"></polyline>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
          <polyline points="7 23 3 19 7 15"></polyline>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
        </svg>
      );
    case 'repeat_on':
      return (
        <svg {...common}>
          <polyline points="17 1 21 5 17 9"></polyline>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
          <polyline points="7 23 3 19 7 15"></polyline>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
          <text
            x="12"
            y="13.5"
            fill="currentColor"
            fontSize="6"
            textAnchor="middle"
            fontWeight="300"
          >
            1
          </text>
        </svg>
      );
    case 'shuffle':
      return (
        <svg {...common}>
          <line x1="4" y1="7" x2="20" y2="7"></line>
          <line x1="4" y1="12" x2="20" y2="12"></line>
          <line x1="4" y1="17" x2="20" y2="17"></line>
        </svg>
      );
    case 'shuffle_on':
      return (
        <svg {...common}>
          <polyline points="16 3 21 3 21 8"></polyline>
          <line x1="4" y1="20" x2="21" y2="3"></line>
          <polyline points="21 16 21 21 16 21"></polyline>
          <line x1="15" y1="15" x2="21" y2="21"></line>
          <line x1="4" y1="4" x2="9" y2="9"></line>
        </svg>
      );
    case 'volume':
      return (
        <svg {...common}>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        </svg>
      );
    case 'volume_muted':
      return (
        <svg {...common}>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <line x1="16" y1="8" x2="22" y2="14"></line>
          <line x1="22" y1="8" x2="16" y2="14"></line>
        </svg>
      );
    default:
      return null;
  }
}

export default Icon;
