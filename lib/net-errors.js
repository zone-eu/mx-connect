/**
 * @fileoverview Network error code to human-readable message mapping.
 * Maps libuv/POSIX socket error codes to descriptive messages for use in
 * connection error responses. Imported by get-connection.js.
 *
 * Error codes sourced from libuv documentation and POSIX standards.
 * Some codes are platform-specific but included for cross-platform compatibility.
 * @module net-errors
 */

'use strict';

module.exports = {
    // Permission and access errors
    EACCES: 'Permission denied',
    EPERM: 'Operation not permitted',
    EBADF: 'Bad file descriptor',

    // Address and binding errors
    EADDRINUSE: 'Address already in use',
    EADDRNOTAVAIL: 'Address not available',
    EAFNOSUPPORT: 'Address family not supported',
    EDESTADDRREQ: 'Destination address required',

    // Connection errors
    ECONNREFUSED: 'Connection refused',
    ECONNRESET: 'Connection reset by peer',
    ECONNABORTED: 'Connection aborted',
    ETIMEDOUT: 'Connection timed out',
    EALREADY: 'Connection already in progress',
    EINPROGRESS: 'Operation in progress',
    EISCONN: 'Socket is already connected',
    ENOTCONN: 'Socket is not connected',

    // Network errors
    ENETDOWN: 'Network is down',
    ENETUNREACH: 'Network is unreachable',
    ENETRESET: 'Network dropped connection on reset',
    EHOSTUNREACH: 'Host is unreachable',
    EHOSTDOWN: 'Host is down',

    // Protocol errors
    EPROTOTYPE: 'Protocol wrong type for socket',
    ENOPROTOOPT: 'Protocol not available',
    EPROTONOSUPPORT: 'Protocol not supported',
    EPROTO: 'Protocol error',

    // Socket errors
    ENOTSOCK: 'Socket operation on non-socket',
    ESOCKTNOSUPPORT: 'Socket type not supported',
    ENOTSUP: 'Operation not supported on socket',
    EOPNOTSUPP: 'Operation not supported on socket',
    EPFNOSUPPORT: 'Protocol family not supported',
    ESHUTDOWN: 'Cannot send after socket shutdown',
    ENOBUFS: 'No buffer space available',
    EMSGSIZE: 'Message too long',

    // I/O errors
    EPIPE: 'Broken pipe',
    EIO: 'I/O error',
    EREMOTEIO: 'Remote I/O error',

    // Resource errors
    EAGAIN: 'Resource temporarily unavailable',
    EWOULDBLOCK: 'Resource temporarily unavailable',
    EINTR: 'Interrupted system call',
    EINVAL: 'Invalid argument',
    ETOOMANYREFS: 'Too many references',

    // Operation lifecycle
    ECANCELED: 'Operation canceled'
};
