/**
 * @fileoverview DNS error code to human-readable message mapping.
 * Maps Node.js DNS error codes (from c-ares library) to descriptive messages
 * for use in error responses. Imported by resolve-mx.js and resolve-ip.js.
 * @module dns-errors
 */

'use strict';

module.exports = {
    // Server-side errors (returned by DNS server)
    ENODATA: 'DNS server returned answer with no data',
    EFORMERR: 'DNS server claims query was misformatted',
    ESERVFAIL: 'DNS server returned general failure',
    ENOTFOUND: 'Domain name not found',
    ENOTIMP: 'DNS server does not implement requested operation',
    EREFUSED: 'DNS server refused query',

    // Client-side errors (generated locally)
    EBADQUERY: 'Misformatted DNS query',
    EBADNAME: 'Invalid hostname',
    EBADFAMILY: 'Unsupported address family',
    EBADRESP: 'Misformatted DNS reply',
    ECONNREFUSED: 'Could not contact DNS servers',
    ETIMEOUT: 'Timeout while contacting DNS servers',
    EOF: 'End of file',
    EFILE: 'Error reading file',
    ENOMEM: 'Out of memory',
    EDESTRUCTION: 'DNS channel is being destroyed',
    EBADSTR: 'Invalid string',
    EBADFLAGS: 'Invalid flags specified',
    ENONAME: 'Given hostname is not numeric',
    EBADHINTS: 'Invalid hints flags specified',

    // Initialization errors
    ENOTINITIALIZED: 'c-ares library initialization not yet performed',
    ELOADIPHLPAPI: 'Error loading Windows iphlpapi.dll',
    EADDRGETNETWORKPARAMS: 'Could not find GetNetworkParams function',

    // Query lifecycle
    ECANCELLED: 'DNS query cancelled'
};
