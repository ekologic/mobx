/// <reference path="./typings/node-0.10.d.ts" />
import events = require('events');

interface IProperty<T> {
	():T;
	(value:T);
	onChange(callback:(newValue:T, oldValue:T)=>void):()=>void;
}

export function property<T>(value:T|{():T}):IProperty<T> {
	var prop:Property<T> = null;

	if (typeof value === "function")
		prop = new ComputedProperty(<()=>T>value);
	else
		prop = new Property(<T>value);

	var propFunc = function(value?:T):T|void {
		if (arguments.length > 0)
			prop.set(value);
		else
			return prop.get();
	};
	(<any>propFunc).onChange = prop.onChange.bind(prop);

	return <IProperty<T>> propFunc;
}

class Property<T> {
	private events = new events.EventEmitter();
	protected dependencyState:DNode = new DNode();

	constructor(protected _value:T){

	}

	set(value:T):Property<T> {
		if (value !== this._value) {
			var oldValue = this._value;
			if (this.dependencyState.state !== DNodeState.COMPUTING)
				this.dependencyState.markUnstable();
			this._value = value;
			this.events.emit('change', value, oldValue);
			this.dependencyState.markStable();
		}
		return this;
	}

	get():T {
		if (this.dependencyState.state !== DNodeState.STABLE)
			throw new Error("Cycle detected in " + this.toString());

		this.dependencyState.notifyObserved();
		return this._value;
	}

	onChange(listener:(newValue:T, oldValue:T)=>void, fireImmediately=false):()=>void {
		var current = this.get(); // make sure the values are initialized
		if (fireImmediately)
			listener(current, undefined);

		this.events.addListener('change', listener);
		return () => {
			this.events.removeListener('change', listener);
		};
	}

	toString() {
		return `Property[${this._value}]`;
	}
}

class ComputedProperty<U> extends Property<U> {
	private initialized = false;
	private privateSetter:(value:U)=>void = null;

	constructor(protected func:()=>U) {
		super(undefined);
		if (!func)
			throw new Error("Computed required a function");

		this.privateSetter = this.set;
		this.set = () => {
			throw new Error("Computed cannot retrieve a new value!");
			return this;
		}

		this.dependencyState.compute = this.compute.bind(this);
	}

	get():U {
		// first evaluation is lazy
		if (!this.initialized) {
			if (this.dependencyState.state !== DNodeState.STABLE)
				throw new Error("Cycle detected in " + this.toString());
			this.dependencyState.computeNextValue();
		}
		return super.get(); // assumption: Compute<> is always synchronous
	}

	compute(onComplete:()=>void) {
		this.privateSetter.call(this, this.func());
		onComplete();
		this.initialized = true;
	}

	toString() {
		return `Property[${this.func.toString()}]`;
	}
}

export class Reference<U extends Model> {

}

export class List<U> {

}

export class Model {

}

interface IObservable<T> {
	onChange(callback:(value:T)=>void);
}

enum DNodeState { UNSTABLE, COMPUTING, STABLE };

class DNode {
	state: DNodeState = DNodeState.STABLE;

	private observing: DNode[] = [];
	private observers: DNode[] = [];

	addObserver(node:DNode) {
		this.observers.push(node);
	}

	removeObserver(node:DNode) {
		var idx = this.observers.indexOf(node);
		if (idx !== -1)
			this.observers.splice(idx, 1);
	}

	markUnstable() {
		if (this.state === DNodeState.COMPUTING)
			throw new Error("Illegal state");
		if (this.state === DNodeState.UNSTABLE)
			return;
		this.state = DNodeState.UNSTABLE;
		this.observers.forEach(observer => observer.notifyStateChange(this));
	}

	markStable() {
		if (this.state === DNodeState.STABLE)
			return;
		this.state = DNodeState.STABLE;
		this.observers.forEach(observer => observer.notifyStateChange(this));
	}

	notifyStateChange(observable:DNode) {
		switch(this.state) {
			case DNodeState.UNSTABLE:
				// The observable has become stable, and all others are stable as well, we can compute now!
				if (observable.state === DNodeState.STABLE && this.observing.filter(o => o.state !== DNodeState.STABLE).length === 0)
					// TODO:
					//Scheduler.schedule(() => this.computeNextValue());
					this.computeNextValue();
				break;
			case DNodeState.STABLE:
			case DNodeState.COMPUTING:
				if (observable.state === DNodeState.UNSTABLE)
					this.markUnstable();
				break;
		}
	}

	computeNextValue() {
		this.state = DNodeState.COMPUTING;
		this.trackDependencies();
		this.compute(() => {
			this.bindDependencies();
			this.markStable();
		});
	}

	compute(onComplete:()=>void) {
		onComplete();
	}

	/*
		Dependency detection
	*/
	// TODO: is trackingstack + push/pop still valid if DNode.compute is executed asynchronously?
	private static trackingStack:DNode[][] = []

	private trackDependencies() {
		this.observing.forEach(observing => observing.removeObserver(this));
		this.observing = null;
		DNode.trackingStack.unshift([]);
	}

	private bindDependencies() {
		var changedObservables = this.observing = DNode.trackingStack.shift();
		changedObservables.forEach(observable => observable.addObserver(this))
	}

	public notifyObserved() {
		if (DNode.trackingStack.length)
			DNode.trackingStack[0].push(this);
	}
}
