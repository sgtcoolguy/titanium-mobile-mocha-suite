'use strict';
/* globals OS_ANDROID,OS_IOS */
const should = require('should');
const utilities = require('./utilities');

// Copied from newer should.js
// Verifies the descriptor for an own property on a target
should.Assertion.add('ownPropertyWithDescriptor', function (name, desc) {
	this.params = { actual: this.obj, operator: 'to have own property `' + name + '` with descriptor ' + JSON.stringify(desc) };

	// descriptors do have default values! If not specified, they're treated as false
	// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/getOwnPropertyDescriptor
	const keys = [ 'writable', 'configurable', 'enumerable' ];
	const descriptor = Object.getOwnPropertyDescriptor(Object(this.obj), name);

	for (let key in keys) {
		const expected = (desc[key] || false);
		const actual = (descriptor[key] || false);
		if (expected !== actual) {
			should.fail(`Expected ${name}.${key} = ${expected}`);
		}
	}
}, false);

// Finds a property up the prototype chain with a given descriptor
should.Assertion.add('propertyWithDescriptor', function (propName, desc) {
	var target = this.obj;
	this.params = { actual: this.obj, operator: 'to have property `' + propName + '` with descriptor ' + JSON.stringify(desc) };
	if (this.obj.apiName) {
		this.params.obj = this.obj.apiName;
	}

	// first let's see if we can find the property up the prototype chain...
	// need to call hasOwnProperty in a funky way due to https://jira.appcelerator.org/browse/TIMOB-23504
	while (!Object.prototype.hasOwnProperty.call(target, propName)) {
		target = Object.getPrototypeOf(target); // go up the prototype chain
		if (!target) {
			should.fail(`Unable to find property ${propName} up the prototype chain!`);
			break;
		}
	}

	// Now verify the property descriptor for it
	should(target).have.ownPropertyWithDescriptor(propName, desc);
}, false);

/**
 * Use this to test for read-only, non-configurable properties on an Object. We
 * will look up the prototype chain to find the owner of the property.
 *
 * @param {String} propName     Name of the property to test for.
 */
should.Assertion.add('readOnlyProperty', function (propName) {
	this.params = { operator: `to have a read-only property with name: ${propName}` };
	if (this.obj.apiName) {
		this.params.obj = this.obj.apiName;
	}

	// Now verify the property descriptor for it
	const props = { writable: false };
	// FIXME read-only properties should also be non-configurable on iOS and Windows (JSC)!
	if (!utilities.isIOS() && !utilities.isWindows()) {
		props.configurable = false;
	}
	this.have.propertyWithDescriptor(propName, props);

	// lastly swap over to the property itself (on our original object)
	this.have.property(propName);
}, false);

// Is this needed? Why not just test for 'property'?
should.Assertion.add('readWriteProperty', function (propName) {
	this.params = { operator: `to have a read-write property with name: ${propName}` };
	if (this.obj.apiName) {
		this.params.obj = this.obj.apiName;
	}

	// Now verify the property descriptor for it
	const props = {
		writable: true,
		enumerable: true,
		configurable: true,
	};
	this.have.propertyWithDescriptor(propName, props);

	// lastly swap over to the property itself (on our original object)
	this.have.property(propName);
}, false);

// TODO Do we need to distinguish between constant and readOnlyproperty?
should.Assertion.alias('readOnlyProperty', 'constant');

should.Assertion.add('enumeration', function (type, names) {
	this.params = { operator: `to have a set of enumerated constants with names: ${names}` };
	if (this.obj.apiName) {
		this.params.obj = this.obj.apiName;
	}

	for (let i = 0; i < names.length; i++) {
		should(this.obj).have.constant(names[i]).which.is.a[type](); // eslint-disable-line no-unused-expressions
	}
}, false);

/**
 * @param {Ti.Blob} blob binary data to write
 * @param {string} imageFilePath relative file path to save image under
 * @returns {Ti.Filesystem.File}
 */
function saveImage(blob, imageFilePath) {
	const file = Ti.Filesystem.getFile(Ti.Filesystem.applicationDataDirectory, imageFilePath);
	if (!file.parent.exists()) {
		file.parent.createDirectory();
	}
	file.write(blob);
	return file;
}

should.Assertion.add('matchImage', function (imageFilePath) {
	this.params = { operator: `view to match snapshot image: ${imageFilePath}` };
	if (this.obj.apiName) {
		this.params.obj = this.obj.apiName;
	}

	const view = this.obj;
	this.have.property('toImage').which.is.a.Function();
	// FIXME: What if use provides a non-view?
	const blob = view.toImage();
	const snapshot = Ti.Filesystem.getFile(Ti.Filesystem.resourcesDirectory, imageFilePath);
	if (!snapshot.exists()) {
		// No snapshot. Generate one, then fail test
		const file = saveImage(blob, imageFilePath);
		console.log(`!IMAGE: {"path":"${file.nativePath}","platform":"${OS_ANDROID ? 'android' : 'ios'}","relativePath":"${imageFilePath}"}`);
		should.fail(`No snapshot image to compare for platform "${OS_ANDROID ? 'android' : 'ios'}": ${imageFilePath}\nGenerated image at ${file.nativePath}`);
		return;
	}

	// Compare versus existing image
	const snapshotBlob = snapshot.read();
	try {
		should(blob.width).equal(snapshotBlob.width, 'width');
		should(blob.height).equal(snapshotBlob.height, 'height');
		should(blob.size).equal(snapshotBlob.size, 'size');
	} catch (e) {
		// assume we failed some assertion, let's try and save the image for reference!
		// The wrapping script should basically generate a "diffs" folder with actual vs expected PNGs in subdirectories
		const file = saveImage(blob, imageFilePath);
		console.log(`!IMG_DIFF: {"path":"${file.nativePath}","platform":"${OS_ANDROID ? 'android' : 'ios'}","relativePath":"${imageFilePath}"}`);
		throw e;
	}

	// use pngjs and pixelmatch!
	const zlib = require('browserify-zlib');
	global.binding.register('zlib', zlib);
	const PNG = require('pngjs').PNG;
	const pixelmatch = require('pixelmatch');

	// Need to create a Buffer around the contents of each image!
	const expectedStream = Ti.Stream.createStream({ source: snapshotBlob, mode: Ti.Stream.MODE_READ });
	const expectedBuffer = Buffer.from(Ti.Stream.readAll(expectedStream));
	const expectedImg = PNG.sync.read(expectedBuffer);

	const actualStream = Ti.Stream.createStream({ source: blob, mode: Ti.Stream.MODE_READ });
	const actualBuffer = Buffer.from(Ti.Stream.readAll(actualStream));
	const actualImg = PNG.sync.read(actualBuffer);

	const { width, height } = actualImg;
	const diff = new PNG({ width, height });
	const pixelsDiff = pixelmatch(actualImg.data, expectedImg.data, diff.data, width, height, { threshold: 0 });
	if (pixelsDiff !== 0) {
		const file = saveImage(blob, imageFilePath); // save "actual"
		// Save diff image!
		const diffBuffer = PNG.sync.write(diff);
		const diffFilePath = imageFilePath.slice(0, -4) + '_diff.png';
		saveImage(diffBuffer.toTiBuffer().toBlob(), diffFilePath); // TODO Pass along path to diff file?
		console.log(`!IMG_DIFF: {"path":"${file.nativePath}","platform":"${OS_ANDROID ? 'android' : 'ios'}","relativePath":"${imageFilePath}"}`);
		should.fail(`Image ${imageFilePath} failed to match, had ${pixelsDiff} differing pixels. View actual/expected/diff images to compare manually.`);
	}
});

// TODO Add an assertion for "exclusive" group of constants: A set of constants whose values must be unique (basically an enum), i.e. Ti.UI.FILL vs SIZE vs UNKNOWN
// TODO Use more custom assertions for things like color properties?
module.exports = should;

const filter = require('./mocha-filter');
// Use custom mocha filters for platform-specific tests
const filters = {
	android: function () {
		return utilities.isAndroid();
	},
	ios: function () {
		return utilities.isIOS();
	},
	ipad: function () {
		return utilities.isIPad();
	},
	iphone: function () {
		return utilities.isIPhone();
	},
	windows: function () {
		return utilities.isWindows();
	},
	// To mark APIs meant to be cross-platform but missing from a given platform
	androidMissing: function () {
		if (utilities.isAndroid()) {
			return 'skip';
		}
		return true;
	},
	iosMissing: function () {
		if (utilities.isIOS()) {
			return 'skip';
		}
		return true;
	},
	windowsMissing: function () {
		if (utilities.isWindows()) {
			return 'skip';
		}
		return true;
	},
	androidIosAndWindowsPhoneBroken: function () {
		if (utilities.isAndroid() || utilities.isIOS() || utilities.isWindowsPhone()) {
			return 'skip';
		}
		return true;
	},
	androidIosAndWindowsDesktopBroken: function () {
		if (utilities.isAndroid() || utilities.isIOS() || utilities.isWindowsDesktop()) {
			return 'skip';
		}
		return true;
	},
	// to mark when there's a bug in both iOS and Android impl
	androidAndIosBroken: function () {
		if (utilities.isAndroid() || utilities.isIOS()) {
			return 'skip';
		}
		return true;
	},
	// to mark when there's a bug in both Android and Windows Desktop impl
	androidAndWindowsDesktopBroken: function () {
		if (utilities.isAndroid() || utilities.isWindowsDesktop()) {
			return 'skip';
		}
		return true;
	},
	// to mark when there's a bug in both Android and Windows Phone impl
	androidAndWindowsPhoneBroken: function () {
		if (utilities.isAndroid() || utilities.isWindowsPhone()) {
			return 'skip';
		}
		return true;
	},
	// to mark when there's a bug in both Android and Windows impl
	androidAndWindowsBroken: function () {
		if (utilities.isAndroid() || utilities.isWindows()) {
			return 'skip';
		}
		return true;
	},
	// to mark when there's a bug in both iOS and Windows impl
	iosAndWindowsBroken: function () {
		if (utilities.isWindows() || utilities.isIOS()) {
			return 'skip';
		}
		return true;
	},
	iosAndWindowsPhoneBroken: function () {
		if (utilities.isIOS() || utilities.isWindowsPhone()) {
			return 'skip';
		}
		return true;
	},
	iosAndWindowsDesktopBroken: function () {
		if (utilities.isWindowsDesktop() || utilities.isIOS()) {
			return 'skip';
		}
		return true;
	},
	// mark bugs specific to Windows 8.1 Desktop/Store
	windowsDesktop81Broken: function () {
		if (utilities.isWindows8_1() || utilities.isWindowsDesktop()) {
			return 'skip';
		}
		return true;
	},
	// mark bugs specific to Windows 8.1 Phone
	windowsPhone81Broken: function () {
		if (utilities.isWindows8_1() || utilities.isWindowsPhone()) {
			return 'skip';
		}
		return true;
	},
	// mark bugs specific to Windows Emulator
	windowsEmulatorBroken: function () {
		if (utilities.isWindowsEmulator()) {
			return 'skip';
		}
		return true;
	},
	// mark bugs specific to Windows Store
	windowsDesktopBroken: function () {
		if (utilities.isWindowsDesktop()) {
			return 'skip';
		}
		return true;
	},
	// mark bugs specific to Windows Phone
	windowsPhoneBroken: function () {
		if (utilities.isWindowsPhone()) {
			return 'skip';
		}
		return true;
	},
	// mark bugs specific to Windows 8.1
	windows81Broken: function () {
		if (utilities.isWindows8_1()) {
			return 'skip';
		}
		return true;
	},
	allBroken: function () {
		return 'skip';
	}
};

// Alias broken tests on a given platform to "missing" filter for that platform.
// This is just handy to try and label where we have gaps in our APIs versus where we have bugs in our impl for a given platform
filters.androidBroken = filters.androidMissing;
filters.iosBroken = filters.iosMissing;
filters.windowsBroken = filters.windowsMissing;
filters.androidAndWindowsMissing = filters.androidAndWindowsBroken;
filters.androidBrokenAndIosMissing = filters.androidAndIosBroken;
filters.androidMissingAndIosBroken = filters.androidAndIosBroken;
filters.androidMissingAndWindowsBroken = filters.androidAndWindowsMissing;
filters.androidMissingAndWindowsDesktopBroken = filters.androidAndWindowsDesktopBroken;
filters.iosMissingAndWindowsDesktopBroken = filters.iosAndWindowsDesktopBroken;
// Add our custom filters
filter.addFilters(filters);
