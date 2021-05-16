// L2-eval-box.ts
// L2 with mutation (set!) and env-box model
// Direct evaluation of letrec with mutation, define supports mutual recursion.

import { add, contains, map, range, reduce, repeat, zipWith } from "ramda";
import { isBoolExp, isCExp, isLitExp, isNumExp, isPrimOp, isStrExp, isVarRef,
         isAppExp, isDefineExp, isIfExp, isLetExp, isProcExp, Binding, VarDecl, CExp, Exp, IfExp, LetExp, ProcExp, Program,
         parseL21Exp, DefineExp, isSetExp, SetExp} from "./L21-ast";
import { applyEnv, applyStore, makeExtEnv, Env, Store, setStore, extendStore, ExtEnv, theGlobalEnv, globalEnvAddBinding, theStore } from "./L21-env-store";
import { isClosure, makeClosure, Closure, Value } from "./L21-value-store";
import { applyPrimitive } from "./evalPrimitive-store";
import { first, rest, isEmpty } from "../shared/list";
import { Result, bind, safe2, mapResult, makeFailure, makeOk, isOk } from "../shared/result";
import { parse as p } from "../shared/parser";
import { env } from "node:process";

// ========================================================
// Eval functions

const applicativeEval = (exp: CExp, env: Env): Result<Value> =>
    isNumExp(exp) ? makeOk(exp.val) :
    isBoolExp(exp) ? makeOk(exp.val) :
    isStrExp(exp) ? makeOk(exp.val) :
    isPrimOp(exp) ? makeOk(exp) :
    isVarRef(exp) ? bind(applyEnv(env, exp.var), addr => applyStore(theStore,addr)): //changed to apply store
    isLitExp(exp) ? makeOk(exp.val as Value) : 
    isIfExp(exp) ? evalIf(exp, env) :
    isProcExp(exp) ? evalProc(exp, env) :
    isLetExp(exp) ? evalLet(exp, env) :
    isSetExp(exp) ? evalSet(exp, env) : //added
    isAppExp(exp) ? safe2((proc: Value, args: Value[]) => applyProcedure(proc, args))
                        (applicativeEval(exp.rator, env), mapResult((rand: CExp) => applicativeEval(rand, env), exp.rands)) :
    exp;

export const isTrueValue = (x: Value): boolean =>
    ! (x === false);

const evalIf = (exp: IfExp, env: Env): Result<Value> =>
    bind(applicativeEval(exp.test, env),
         (test: Value) => isTrueValue(test) ? applicativeEval(exp.then, env) : applicativeEval(exp.alt, env));

//
const evalSet = (exp: SetExp, env: Env): Result<void> =>
    {
        const variable = exp.var.var;//var that needs to be changed
        const addr = applyEnv(env, variable);//find address the variable that needs to be changed
        const val1 = applicativeEval(exp.val, env);//eval the value
        return safe2((address: number, val2: Value) => makeOk(setStore(theStore, address, val2)))
                (addr, val1);    
    }

//  safe2((val: Value, bdg: FBinding) => makeOk(setFBinding(bdg, val)))
    //    (applicativeEval(exp.val, env), applyEnvBdg(env, exp.var.var));

const evalProc = (exp: ProcExp, env: Env): Result<Closure> =>
    makeOk(makeClosure(exp.args, exp.body, env));

// KEY: This procedure does NOT have an env parameter.
//      Instead we use the env of the closure.
const applyProcedure = (proc: Value, args: Value[]): Result<Value> =>
    isPrimOp(proc) ? applyPrimitive(proc, args) :
    isClosure(proc) ? applyClosure(proc, args) :
    makeFailure(`Bad procedure ${JSON.stringify(proc)}`);

const applyClosure = (proc: Closure, args: Value[]): Result<Value> => {
    const vars = map((v: VarDecl) => v.var, proc.params);
    map(x => extendStore(theStore,x) ,args);
    const addresses: number[] = range(theStore.vals.length - args.length, theStore.vals.length);//check
    const newEnv: ExtEnv = makeExtEnv(vars, addresses, proc.env)
    return evalSequence(proc.body, newEnv);
}

// Evaluate a sequence of expressions (in a program)
export const evalSequence = (seq: Exp[], env: Env): Result<Value> =>
    isEmpty(seq) ? makeFailure("Empty program") :
    evalCExps(first(seq), rest(seq), env);
    
const evalCExps = (first: Exp, rest: Exp[], env: Env): Result<Value> =>
    isDefineExp(first) && isEmpty(rest) ? evalDefineExp(first, rest) :
    isDefineExp(first) ? bind(evalDefineExp(first, rest), _ => evalSequence(rest, env)) : 
    isCExp(first) && isEmpty(rest) ? applicativeEval(first, env) :
    isCExp(first) ? bind(applicativeEval(first, env), _ => evalSequence(rest, env)) :
    first;

// globalEnv    
const evalDefineExp = (def: DefineExp, exps: Exp[]): Result<Value> =>{
    const variable = def.var.var;
    const val = applicativeEval(def.val, theGlobalEnv);
    const ans = evalCExps(first(exps), rest(exps), theGlobalEnv);
    if(ans.tag === "Ok"){
        const store = bind(val,(val1: Value) => makeOk(extendStore(theStore, ans.value))); //add the evaluated value
        const addr = isOk(store) ? (theStore.vals.length -1) : -1;
        globalEnvAddBinding(variable, addr); //add the var to the globalEnv
    }
    return ans;
}

// Main program
// L2-BOX @@ Use GE instead of empty-env
export const evalProgram = (program: Program): Result<Value> =>
    evalSequence(program.exps, theGlobalEnv);

export const evalParse = (s: string): Result<Value> =>
    bind(bind(p(s), parseL21Exp), (exp: Exp) => evalSequence([exp], theGlobalEnv));

// LET: Direct evaluation rule without syntax expansion
// compute the values, extend the env, eval the body.
const evalLet = (exp: LetExp, env: Env): Result<Value> => {
    const vals = mapResult((v: CExp) => applicativeEval(v, env), map((b: Binding) => b.val, exp.bindings));
    const vars = map((b: Binding) => b.var.var, exp.bindings);

    
    return bind(vals, (vals: Value[]) => {
        map(x => extendStore(theStore,x) ,vals);
        const addresses = range(theStore.vals.length - vals.length, theStore.vals.length);
        const newEnv = makeExtEnv(vars, addresses, env)
        return evalSequence(exp.body, newEnv);
    })
}
