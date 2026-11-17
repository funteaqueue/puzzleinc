// Older drawing servers only send the message, without a machine-readable code.
export function isDuplicateConnection(error){
 return error?.type==='error'&&(error.code==='duplicate-identity'||error.message==='На цьому комп’ютері вже працює підключена копія Puzzle Ink.');
}
export const reconnectMessage='Попереднє підключення ще закривається. Відновлюю сесію…';

export const replacedCloseCode = 4001;
export const replacedMessage = 'Цей профіль підключився знову. Щоб повернутися з цієї копії, натисніть «Підключитися».';
