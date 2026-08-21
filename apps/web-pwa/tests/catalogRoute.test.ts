import { describe, it, expect } from 'vitest';
import {
  canonKey,
  formKey,
  parseRecordKey,
  readCatalogArrival,
  routeRecordKey,
} from '../src/routes/admin/catalogRoute.js';

describe('catalog record keys', () => {
  it('round-trips a key through its kind and id', () => {
    expect(parseRecordKey(canonKey('lemon'))).toEqual({ kind: 'canon', id: 'lemon' });
    expect(parseRecordKey(formKey('juice'))).toEqual({ kind: 'form', id: 'juice' });
  });

  it('rejects anything that is not namespaced — a bare id is ambiguous across two collections', () => {
    expect(parseRecordKey('lemon')).toBeNull();
  });
});

describe('which door the catalog was opened by', () => {
  it('presets the forms view and keeps the old list path for the product-forms aliases', () => {
    const arrival = readCatalogArrival('/admin/product-forms/form-1');
    expect(arrival).toEqual({
      filter: 'has-forms',
      listPath: '/admin/product-forms',
      idKind: 'form',
    });
    expect(routeRecordKey(arrival, 'form-1')).toBe('f:form-1');
  });

  it('reads a canon alias id as a canon record', () => {
    const arrival = readCatalogArrival('/admin/canon/lemon');
    expect(arrival.listPath).toBe('/admin/canon');
    expect(routeRecordKey(arrival, 'lemon')).toBe('c:lemon');
  });

  it('takes the id on its own path already namespaced, and opens nothing when it is not', () => {
    const arrival = readCatalogArrival('/admin/catalog/c:lemon');
    expect(arrival.idKind).toBeNull();
    expect(routeRecordKey(arrival, 'c:lemon')).toBe('c:lemon');
    expect(routeRecordKey(arrival, 'lemon')).toBeNull();
    expect(routeRecordKey(arrival, undefined)).toBeNull();
  });

  it('ignores a querystring when reading the path', () => {
    expect(readCatalogArrival('/admin/catalog?parent=x').listPath).toBe('/admin/catalog');
  });
});
