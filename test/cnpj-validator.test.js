import { CNPJValidator } from '../public/script.js';

describe('CNPJValidator', () => {
  describe('clean', () => {
    test('should remove non-digit characters', () => {
      expect(CNPJValidator.clean('12.345.678/0001-95')).toBe('12345678000195');
      expect(CNPJValidator.clean('12.345.678/0001-95')).toBe('12345678000195');
      expect(CNPJValidator.clean('abc123')).toBe('123');
    });
  });

  describe('format', () => {
    test('should format valid CNPJ', () => {
      expect(CNPJValidator.format('12345678000195')).toBe('12.345.678/0001-95');
      expect(CNPJValidator.format('12345678000195')).toBe('12.345.678/0001-95');
    });

    test('should return original if invalid length', () => {
      expect(CNPJValidator.format('123')).toBe('123');
    });
  });

  describe('validate', () => {
    test('should validate correct CNPJ', () => {
      const result = CNPJValidator.validate('12.345.678/0001-95');
      expect(result.isValid).toBe(true);
      expect(result.cleaned).toBe('12345678000195');
    });

    test('should reject invalid CNPJ', () => {
      const result = CNPJValidator.validate('11.111.111/1111-11');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('CNPJ com dígitos repetidos é inválido');
    });

    test('should reject wrong length', () => {
      const result = CNPJValidator.validate('123');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('CNPJ deve conter 14 dígitos');
    });

    test('should reject invalid digit', () => {
      const result = CNPJValidator.validate('12.345.678/0001-00');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Dígito verificador inválido');
    });
  });
});