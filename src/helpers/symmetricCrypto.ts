const crypto = require('crypto');

//crypto configuration
const algorithm = 'aes-256-ctr';
//!this key needs to be 32 byte(256 bit). Also please use env vars in a real project

const iv: Buffer = crypto.randomBytes(16);

export const encrypt = (key: string, str: string) => {

  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(str), cipher.final()]);

  return {
    ivString: iv.toString('hex'),
    content: encrypted.toString('hex'),
  };
};

export const decrypt = (key: string, ivString: string, content: string) => {
  const decipher = crypto.createCipheriv(algorithm, key, Buffer.from(ivString, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(content, 'hex')), decipher.final()]);

  const decryptedString = decrypted.toString();
  return decryptedString;
};
