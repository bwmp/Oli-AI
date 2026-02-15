import { readdirSync, existsSync } from 'fs';
import { Collection } from 'discord.js';
import { Button } from '~/types/Objects';

// Set the buttons collection
const buttons = new Collection<string, Button>();

// Register all buttons
const buttonsFolderPath = './src/buttons';

if (existsSync(buttonsFolderPath)) {
  const buttonFiles = readdirSync(buttonsFolderPath).filter(file => file.endsWith('.ts'));
  buttonFiles.forEach(async file => {
    let button = require(`../buttons/${file}`);
    const name = Object.keys(button)[0] as keyof typeof button;
    button = { name, ...button[name] };

    buttons.set(button.name, button);
  });
  logger.info(`${buttonFiles.length} buttons loaded`);
} else {
  logger.info('Buttons folder does not exist, no buttons loaded');
}

export default buttons;