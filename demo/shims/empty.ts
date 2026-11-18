// Модули, которые в демо не нужны (nodemailer, @google/genai): вызовы до них не доходят.
export class GoogleGenAI { constructor() { throw new Error('В демо ИИ-провайдеры недоступны'); } }
export const createTransport = () => { throw new Error('В демо почты нет'); };
export default { createTransport };
