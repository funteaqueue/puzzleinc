import test from 'node:test';
import assert from 'node:assert/strict';
import {isDuplicateConnection} from '../../frontend/lib/connection-errors.mjs';

test('duplicate rejection is retryable without retrying authentication or protocol errors',()=>{
 assert.equal(isDuplicateConnection({type:'error',code:'duplicate-identity'}),true);
 assert.equal(isDuplicateConnection({type:'error',message:'На цьому комп’ютері вже працює підключена копія Puzzle Ink.'}),true);
 for(const error of [null,{}, {type:'ready'}, {type:'error',message:'Ця збірка не має доступу до персональної сесії.'},{type:'error',message:'Оновіть Puzzle Ink до 0.4 на всіх комп’ютерах.'}])assert.equal(isDuplicateConnection(error),false);
});
