import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './skins/skins.css';
import { bootstrapAppearance } from './utils/bootstrapUi';

async function start() {
  try {
    await bootstrapAppearance();
  } finally {
    document.documentElement.classList.remove('ui-boot');
    const bootLoader = document.getElementById('ui-boot-loader');
    if (bootLoader) {
      bootLoader.removeAttribute('aria-busy');
      bootLoader.remove();
    }
  }

  const container = document.getElementById('root');
  const root = createRoot(container);
  root.render(<App />);
}

void start();
